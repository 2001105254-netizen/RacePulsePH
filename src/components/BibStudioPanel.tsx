import { ChangeEvent, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { FileDown, FileSpreadsheet, ImagePlus, Plus, Printer, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { Race, RaceBibFont, RaceBibLayout, RaceBibTemplate, RunnerProfile } from '../types';
import { generateRaceBibsPdf } from '../lib/raceBibPdf';
import { resizeImageToDataUrl } from '../lib/image';
import { raceBibFontFamily } from '../lib/raceBibFont';

type StudioRow = { id: string; fullName: string; bibNumber: string; distance: string };

const defaultLayout: RaceBibLayout = {
  bibNumberX: 50,
  bibNumberY: 48,
  runnerNameX: 50,
  runnerNameY: 70,
  bibNumberSize: 18,
  runnerNameSize: 6,
  bibNumberColor: '#FFFFFF',
  runnerNameColor: '#FFFFFF',
  bibNumberStrokeColor: '#000000',
  runnerNameStrokeColor: '#000000',
  bibNumberStrokeWidth: 0,
  runnerNameStrokeWidth: 0,
  bibNumberFont: 'mono',
  runnerNameFont: 'display',
};

const cleanHeader = (value: unknown) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const cleanValue = (value: unknown) => String(value ?? '').trim();

function valueFromRow(row: Record<string, unknown>, choices: string[]): string {
  const entry = Object.entries(row).find(([key]) => choices.includes(cleanHeader(key)));
  return cleanValue(entry?.[1]);
}

function parseRoster(rows: Record<string, unknown>[]): { entries: StudioRow[]; rejected: number } {
  let rejected = 0;
  const usedBibs = new Set<string>();
  const entries = rows.flatMap((row, index) => {
    const fullName = valueFromRow(row, ['fullname', 'runnername', 'name']);
    const bibNumber = valueFromRow(row, ['racebibnumber', 'bibnumber', 'bib', 'racenumber']);
    const distance = valueFromRow(row, ['distance', 'km', 'category']) || 'General';
    const bibKey = bibNumber.toUpperCase();
    if (!fullName || !bibNumber || usedBibs.has(bibKey)) {
      rejected += 1;
      return [];
    }
    usedBibs.add(bibKey);
    return [{ id: `${index}-${bibKey}`, fullName, bibNumber, distance }];
  });
  return { entries, rejected };
}

function filenameSafe(value: string): string {
  return value.trim().replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'RacePulsePH';
}

export default function BibStudioPanel() {
  const [jobName, setJobName] = useState('');
  const [rows, setRows] = useState<StudioRow[]>([]);
  const [templateImage, setTemplateImage] = useState('');
  const [distanceTemplates, setDistanceTemplates] = useState<Record<string, RaceBibTemplate>>({});
  const [layout, setLayout] = useState<RaceBibLayout>(defaultLayout);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);
  const distanceInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const distances = useMemo(() => [...new Set(rows.map((row) => row.distance).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [rows]);
  const preview = rows[0] || { fullName: 'RUNNER NAME', bibNumber: 'BIB-001', distance: 'General' };

  const readRoster = async (file: File) => {
    setMessage('');
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!worksheet) throw new Error('No worksheet was found in that file.');
      const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
      const { entries, rejected } = parseRoster(parsed);
      if (entries.length === 0) throw new Error('No valid rows found. Use Full Name, Race Bib Number, and Distance columns.');
      setRows(entries);
      setMessage(`${entries.length} bibs ready${rejected ? ` · ${rejected} duplicate or incomplete row${rejected === 1 ? '' : 's'} skipped` : ''}.`);
    } catch (error: any) {
      setMessage(error.message || 'Could not import the roster.');
    }
  };

  const onRosterSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void readRoster(file);
  };

  const loadTemplate = async (file: File, distance?: string) => {
    setBusy(true);
    setMessage('');
    try {
      const image = await resizeImageToDataUrl(file, 1200, 800, 0.84);
      if (distance) setDistanceTemplates((current) => ({ ...current, [distance]: { image, layout } }));
      else setTemplateImage(image);
    } catch (error: any) {
      setMessage(error.message || 'Could not process the bib artwork.');
    } finally {
      setBusy(false);
    }
  };

  const onTemplateSelected = (event: ChangeEvent<HTMLInputElement>, distance?: string) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void loadTemplate(file, distance);
  };

  const updateLayout = (patch: Partial<RaceBibLayout>) => {
    setLayout((current) => ({ ...current, ...patch }));
    setDistanceTemplates((current) => Object.fromEntries(Object.entries(current).map(([distance, template]) => [distance, { ...template, layout: { ...template.layout, ...patch } }])));
  };

  const generate = async (distance?: string) => {
    if (!jobName.trim()) return setMessage('Enter the client or event name first.');
    if (rows.length === 0) return setMessage('Import a roster before generating the PDF.');
    if (!templateImage && Object.keys(distanceTemplates).length === 0) return setMessage('Upload a default bib design or a design for every distance.');
    const selectedRows = distance ? rows.filter((row) => row.distance === distance) : rows;
    const missingTemplate = selectedRows.find((row) => !distanceTemplates[row.distance]?.image && !templateImage);
    if (missingTemplate) return setMessage(`No design is available for ${missingTemplate.distance}. Upload its distance design or a default design.`);

    setBusy(true);
    setMessage('Preparing your print-ready PDF…');
    try {
      const race: Race = {
        id: `bib-studio-${Date.now()}`,
        name: jobName.trim(),
        date: new Date().toISOString().slice(0, 10),
        checkpoints: [],
        ageCategories: [],
        distances: distances.map((label, index) => ({ id: `studio-${index}`, km: index + 1, label, price: 0 })),
        inclusions: [],
        createdBy: 'bib-studio',
        createdAt: new Date().toISOString(),
        raceBibTemplateImage: templateImage || undefined,
        raceBibLayout: layout,
        raceBibTemplatesByDistance: Object.keys(distanceTemplates).length ? distanceTemplates : undefined,
      };
      const now = new Date().toISOString();
      const runners: RunnerProfile[] = selectedRows.map((row, index) => ({
        uid: `studio-${index}`,
        raceId: race.id,
        fullName: row.fullName,
        bibNumber: row.bibNumber,
        distance: row.distance,
        gender: 'male',
        age: 0,
        createdAt: now,
      }));
      const count = await generateRaceBibsPdf(race, runners, distance);
      setMessage(`${count} personalized race bib${count === 1 ? '' : 's'} downloaded as a print-ready PDF.`);
    } catch (error: any) {
      setMessage(error.message || 'Could not generate the PDF.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setJobName('');
    setRows([]);
    setTemplateImage('');
    setDistanceTemplates({});
    setLayout(defaultLayout);
    setMessage('New printing job ready.');
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fadeIn">
      <header className="glass-panel hero-glow p-5 sm:p-7 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/25 bg-violet-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-violet-500"><Printer className="w-3.5 h-3.5" /> Print service</span>
          <h2 className="heading-float mt-3 text-2xl font-black font-display uppercase text-[var(--text-primary)]">Race Bib Studio</h2>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">Standalone client job: import names and bib numbers, overlay them on artwork, then download two borderless bibs per A4 PDF page.</p>
        </div>
        <button type="button" onClick={reset} className="shrink-0 rounded-xl border border-[var(--border-default)] px-4 py-2.5 text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] hover:border-red-500 hover:text-red-500 transition">New Job</button>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.05fr] gap-6">
        <section className="glass-panel p-5 space-y-5">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-2">Client / event name</label>
            <input value={jobName} onChange={(event) => setJobName(event.target.value)} placeholder="Example: Sumilao Trail Run 2026" className="w-full glass-inset px-4 py-3 text-sm font-bold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
          </div>

          <div className="rounded-2xl border border-dashed border-violet-500/35 bg-violet-500/[0.03] p-4">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-widest text-[var(--text-primary)]">1. Import roster</p><p className="mt-1 text-[11px] text-[var(--text-secondary)]">Excel, CSV, or TSV. Required columns: <strong>Full Name</strong>, <strong>Race Bib Number</strong>, and <strong>Distance</strong>.</p></div><FileSpreadsheet className="w-5 h-5 text-violet-500 shrink-0" /></div>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="hidden" onChange={onRosterSelected} />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy} className="mt-4 w-full rounded-xl bg-violet-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-violet-500 disabled:opacity-60 flex items-center justify-center gap-2"><Upload className="w-4 h-4" /> Upload roster</button>
            {rows.length > 0 && <div className="mt-3 rounded-xl bg-[var(--surface-inset)] px-3 py-2 text-xs text-[var(--text-secondary)]"><strong className="text-emerald-500">{rows.length} bibs ready</strong> · {distances.join(', ')}</div>}
          </div>

          <div>
            <div className="flex items-center justify-between gap-3 mb-2"><div><p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">2. Default bib design</p><p className="mt-1 text-[11px] text-[var(--text-muted)]">Recommended artwork: 1200 × 800 px, landscape 3:2.</p></div>{templateImage && <button type="button" onClick={() => setTemplateImage('')} className="text-[10px] font-black uppercase tracking-wide text-red-500 hover:text-red-400">Remove</button>}</div>
            <input ref={templateInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => onTemplateSelected(event)} />
            {templateImage ? <button type="button" onClick={() => templateInputRef.current?.click()} className="group relative block w-full overflow-hidden rounded-2xl border border-[var(--border-default)]"><img src={templateImage} alt="Default bib design" className="aspect-[3/2] w-full object-cover" /><span className="absolute inset-x-0 bottom-0 bg-black/65 px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white opacity-0 transition group-hover:opacity-100">Replace default design</span></button> : <button type="button" onClick={() => templateInputRef.current?.click()} disabled={busy} className="w-full aspect-[3/2] rounded-2xl border-2 border-dashed border-[var(--border-default)] flex flex-col items-center justify-center gap-2 text-[var(--text-secondary)] hover:text-violet-500 hover:border-violet-500/50 transition disabled:opacity-60"><ImagePlus className="w-7 h-7" /><span className="text-xs font-black uppercase tracking-wide">Upload default design</span></button>}
          </div>

          {distances.length > 0 && <div className="space-y-3"><div><p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Optional distance designs</p><p className="mt-1 text-[11px] text-[var(--text-muted)]">Use a different artwork for each distance; otherwise the default design is used.</p></div><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{distances.map((distance) => <div key={distance} className="glass-inset p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-black text-[var(--text-primary)]">{distance}</span>{distanceTemplates[distance] && <button type="button" onClick={() => setDistanceTemplates((current) => { const next = { ...current }; delete next[distance]; return next; })} className="text-[10px] font-black uppercase text-red-500">Remove</button>}</div><input ref={(node) => { distanceInputRefs.current[distance] = node; }} type="file" accept="image/*" className="hidden" onChange={(event) => onTemplateSelected(event, distance)} />{distanceTemplates[distance] ? <button type="button" onClick={() => distanceInputRefs.current[distance]?.click()} className="mt-2 w-full overflow-hidden rounded-lg border border-[var(--border-default)]"><img src={distanceTemplates[distance].image} alt={`${distance} bib design`} className="aspect-[3/2] w-full object-cover" /></button> : <button type="button" onClick={() => distanceInputRefs.current[distance]?.click()} className="mt-2 w-full rounded-lg border border-dashed border-[var(--border-default)] px-2 py-5 text-[10px] font-black uppercase tracking-wide text-violet-500 hover:bg-violet-500/5">Add {distance} design</button>}</div>)}</div></div>}
        </section>

        <section className="glass-panel p-5 space-y-5">
          <div><p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">3. Text & print layout</p><p className="mt-1 text-[11px] text-[var(--text-muted)]">Settings apply to the default and all distance designs.</p></div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <LayoutControls title="Bib number" layout={layout} onChange={updateLayout} prefix="bibNumber" />
            <LayoutControls title="Runner name" layout={layout} onChange={updateLayout} prefix="runnerName" />
          </div>
          <div className="rounded-2xl overflow-hidden border border-[var(--border-default)] bg-black relative aspect-[3/2]">
            {templateImage ? <img src={distanceTemplates[preview.distance]?.image || templateImage} alt="Race bib preview" className="absolute inset-0 w-full h-full object-cover" /> : <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-zinc-800 to-zinc-950 text-xs text-zinc-400">Upload a design to preview</div>}
            {templateImage && <><span style={{ left: `${layout.bibNumberX}%`, top: `${layout.bibNumberY}%`, color: layout.bibNumberColor, fontFamily: raceBibFontFamily(layout.bibNumberFont, undefined), WebkitTextStroke: `${Math.max(0, layout.bibNumberStrokeWidth || 0) * 2}px ${layout.bibNumberStrokeColor || '#000000'}` }} className="absolute -translate-x-1/2 -translate-y-1/2 text-[clamp(18px,8cqw,80px)] leading-none font-black whitespace-nowrap">{preview.bibNumber}</span><span style={{ left: `${layout.runnerNameX}%`, top: `${layout.runnerNameY}%`, color: layout.runnerNameColor, fontFamily: raceBibFontFamily(layout.runnerNameFont, undefined), WebkitTextStroke: `${Math.max(0, layout.runnerNameStrokeWidth || 0) * 2}px ${layout.runnerNameStrokeColor || '#000000'}` }} className="absolute -translate-x-1/2 -translate-y-1/2 text-[clamp(12px,3.3cqw,34px)] leading-none font-black whitespace-nowrap max-w-[90%] truncate">{preview.fullName}</span></>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button type="button" onClick={() => void generate()} disabled={busy || rows.length === 0} className="rounded-xl bg-red-600 px-4 py-3.5 text-xs font-black uppercase tracking-widest text-white hover:bg-red-500 disabled:opacity-60 flex items-center justify-center gap-2">{busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} Download all PDF</button>
            {distances.length > 1 && <div className="grid grid-cols-2 gap-2">{distances.map((distance) => <button key={distance} type="button" onClick={() => void generate(distance)} disabled={busy} className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-3 text-[10px] font-black uppercase tracking-wide text-violet-500 hover:bg-violet-500 hover:text-white disabled:opacity-60">{distance} PDF</button>)}</div>}
          </div>
          {message && <p role="status" className={`rounded-xl px-3 py-2.5 text-xs font-semibold ${message.includes('Could not') || message.includes('Enter ') || message.includes('Import ') || message.includes('No design') ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'}`}>{message}</p>}
        </section>
      </div>
    </div>
  );
}

function LayoutControls({ title, layout, onChange, prefix }: { title: string; layout: RaceBibLayout; onChange: (patch: Partial<RaceBibLayout>) => void; prefix: 'bibNumber' | 'runnerName' }) {
  const isBib = prefix === 'bibNumber';
  const xKey = `${prefix}X` as const;
  const yKey = `${prefix}Y` as const;
  const sizeKey = `${prefix}Size` as const;
  const colorKey = `${prefix}Color` as const;
  const strokeColorKey = `${prefix}StrokeColor` as const;
  const strokeWidthKey = `${prefix}StrokeWidth` as const;
  const fontKey = `${prefix}Font` as const;
  return <div className="glass-inset p-4 space-y-3"><p className="text-xs font-black uppercase tracking-widest text-[var(--text-primary)]">{title}</p><Range label="X position" value={layout[xKey]} min={5} max={95} suffix="%" onChange={(value) => onChange({ [xKey]: value })} /><Range label="Y position" value={layout[yKey]} min={5} max={95} suffix="%" onChange={(value) => onChange({ [yKey]: value })} /><Range label="Size" value={layout[sizeKey] || (isBib ? 18 : 6)} min={isBib ? 8 : 3} max={isBib ? 30 : 14} step={0.5} onChange={(value) => onChange({ [sizeKey]: value })} /><div className="grid grid-cols-2 gap-2"><Color label="Text" value={layout[colorKey] || '#FFFFFF'} onChange={(value) => onChange({ [colorKey]: value })} /><Color label="Border" value={layout[strokeColorKey] || '#000000'} onChange={(value) => onChange({ [strokeColorKey]: value })} /></div><Range label="Border thickness" value={layout[strokeWidthKey] || 0} min={0} max={2} step={0.1} onChange={(value) => onChange({ [strokeWidthKey]: value })} /><label className="block text-[10px] font-bold text-[var(--text-secondary)]">Font<select value={layout[fontKey] || (isBib ? 'mono' : 'display')} onChange={(event) => onChange({ [fontKey]: event.target.value as RaceBibFont })} className="mt-1 w-full glass-inset px-2 py-2 text-xs font-bold text-[var(--text-primary)]"><option value="display">Racing Bold</option><option value="sans">Clean Sans</option><option value="mono">Timing Mono</option><option value="condensed">Condensed</option></select></label></div>;
}

function Range({ label, value, min, max, step = 1, suffix = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void }) {
  return <label className="block text-[10px] font-bold text-[var(--text-secondary)]"><span className="flex justify-between gap-2"><span>{label}</span><span className="font-mono text-[var(--text-primary)]">{value}{suffix}</span></span><input className="mt-1.5 w-full accent-red-600" type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="text-[10px] font-bold text-[var(--text-secondary)]">{label}<span className="mt-1 flex items-center gap-2"><input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-8 rounded border-0 bg-transparent p-0" /><span className="font-mono text-[10px] text-[var(--text-primary)]">{value}</span></span></label>;
}
