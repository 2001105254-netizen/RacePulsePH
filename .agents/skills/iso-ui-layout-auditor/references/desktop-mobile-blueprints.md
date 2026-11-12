# Dual-Viewport Audit Deliverable & Blueprint Reference

Use this template to produce Sections 1 through 5 and the ADR summary in every `iso-ui-layout-auditor` audit.

## Section 1 & 2: Pixel-Waste Quantification & Dual Scorecards

1. **Quantify spatial waste explicitly** for both `1366x768` / `1920x1080` Desktop and `390x844` Mobile:
   - Header height above primary controls (target `<= 52px` desktop, `48px` mobile sticky bar).
   - Decorative hero/welcome banner height (`target: 0px`).
   - KPI grid vertical bloat vs `<= 40px` telemetry ribbon (`target: <= 40px` desktop, collapsed drawer on mobile).
   - Lateral dead-zone gutters (`max-w-*` unused pixels on `1366px` and `1920px` screens, `target: 0px`).
   - Scroll depth required to reach primary CTA (`target: 0px`, above the fold on desktop, anchored in bottom `30%` thumb arc on mobile).
2. **Score every item** in the Desktop Checklist (`6` items) and Mobile Checklist (`6` items) as `PASS`, `PARTIAL`, or `FAIL` with the exact file/line or screenshot region.

## Section 3: Element Relocation Matrix Template

| Legacy Component | Desktop Target (`100vh`) | Mobile Target (`100dvh`) | Space Saved | ISO Standard |
| --- | --- | --- | --- | --- |
| Welcome banner & subtitle | Removed (breadcrumb in `52px` top bar) | Removed (title in `48px` sticky bar) | `~120px` vertical | ISO 9241-112, 9241-115 |
| Multi-card KPI grid | `<= 40px` read-only telemetry ribbon | Collapsible sheet inside `48px` top bar | `~180px` vertical | ISO 11064-5, 9241-125 |
| Centered `max-w-5xl` wrapper | Full-bleed `w-full` `64%` / `36%` split | Full-width `100%` 2-line hybrid cards | `~320px+` lateral | ISO 11064-4, 9241-125 |
| Inline hardware / config panel | Persistent `36%` right-hand dock | On-demand bottom-sheet modal | Eliminates scroll | ISO 11064-4, 9241-161 |
| Top-buried primary CTA button | Toolbar / right dock + `F1` hotkey | Sticky `bottom-0` thumb-zone dock (`h-11+`) | Zero scroll reach | ISO 9241-920, 9241-110 |

## Section 4: Dual ASCII Wireframes

### Desktop (`1366x768` / `1920x1080`, `100vh` Zero-Scroll Lock)

```text
+---------------------------------------------------------------------------------------------------+
| [Brand] / Timing Console         | Race: [ 2026 Ridge Run 21K v ] | [Sync F3] [Export F4] [? Keys]| <=52px
+---------------------------------------------------------------------------------------------------+
| * LAN Ready | Reads: 1,420 | Checked In: 812 / 900 | Queue: 0 | Clock: 06:42:18.420 (tabular)     | <=40px
+------------------------------------------------------------------+--------------------------------+
| [Search bib/name (Ctrl+F)...        ] [All] [Paid] [Flagged]     | ACTIVE CONTROL DOCK (36%)      |
+------------------------------------------------------------------+--------------------------------+
| Bib  | Runner Name       | Div   | Official Time | Status        | [Scan Bib QR (F1)]             |
+------+-------------------+-------+---------------+---------------+ [Manual Bib: _____ ] [Assign]  |
| 0104 | Dela Cruz, Mateo  | 21K M | 01:34:12.840  | FINISHED      |--------------------------------|
| 0105 | Santos, Clara     | 21K F | 01:35:08.110  | FINISHED      | Selected: #0104 Dela Cruz      |
| 0106 | Reyes, Paolo      | 21K M | --:--:--.---  | ON COURSE     | Chip EPC: E280-1170-0000-0104  |
| ...  | (independent scroll, sticky <thead>, 64% width)           | [Verify Read (F2)]             |
|      |                                                           |--------------------------------|
|      |                                                           | Safety Zone: [Reset Read...]   |
+------------------------------------------------------------------+--------------------------------+
```

### Mobile (`390x844`, `100dvh` Thumb-Zone Field-Staff View)

```text
+---------------------------------------+
| Timing Console  [21K v] [Telemetry v] | <=48px sticky top bar (opens collapsible summary sheet)
+---------------------------------------+
| [Search bib or name...              ] |
| [All] [Checked In] [Pending] [Flags]  | (horizontal scroll pills, min-h-11)
+---------------------------------------+
| #0104  Dela Cruz, Mateo   [FINISHED]  | Line 1: Bib + Name + Status Badge
| 21K M  |  01:34:12.840  | [Inspect >] | Line 2: Category + Official Time + One-Tap Action (h-11)
+---------------------------------------+
| #0105  Santos, Clara      [FINISHED]  |
| 21K F  |  01:35:08.110  | [Inspect >] |
+---------------------------------------+
| #0106  Reyes, Paolo       [ON COURSE] |
| 21K M  |  --:--:--.---  | [Check In ] |
+---------------------------------------+
|  ... scrollable list (pb-24 clear)    |
+---------------------------------------+
| [ Controls (Sheet) ] [ Scan Bib QR  ] | <= bottom-0 sticky thumb dock (min-h-11, gap-2 >= 8px)
+---------------------------------------+
```

## Section 5: Production-Ready Responsive Skeleton (React + Tailwind CSS)

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { QrCode, RefreshCw, SlidersHorizontal, ChevronDown, ShieldAlert, X } from 'lucide-react';

interface RunnerRow {
  id: string;
  bib: string;
  name: string;
  category: string;
  officialTime: string;
  status: 'FINISHED' | 'ON_COURSE' | 'PENDING';
}

export function IsoOperatorConsole({
  races,
  selectedRaceId,
  onSelectRace,
  rows,
  lanConnected,
  pendingQueue,
  elapsedClock,
  onScanQr,
  onCopySummary,
  onSync,
  onExport,
  onTogglePrimaryTimer,
  onAssignChip,
  onConfirmedReset,
}: {
  races: Array<{ id: string; name: string }>;
  selectedRaceId: string;
  onSelectRace: (id: string) => void;
  rows: RunnerRow[];
  lanConnected: boolean;
  pendingQueue: number;
  elapsedClock: string;
  onScanQr: () => void;
  onCopySummary: () => void;
  onSync: () => void;
  onExport: () => void;
  onTogglePrimaryTimer: () => void;
  onAssignChip: (bib: string) => void;
  onConfirmedReset: () => void;
}) {
  const [query, setQuery] = useState('');
  const [manualBib, setManualBib] = useState('');
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inFormField = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      const inInteractive = target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === 'Escape') {
        setMobileControlsOpen(false);
        setTelemetryOpen(false);
        setResetArmed(false);
        return;
      }
      if (inFormField) return;
      if (event.key === 'F1') { event.preventDefault(); onScanQr(); }
      if (event.key === 'F2') { event.preventDefault(); onCopySummary(); }
      if (event.key === 'F3') { event.preventDefault(); onSync(); }
      if (event.key === 'F4') { event.preventDefault(); onExport(); }
      if (event.code === 'Space' && !inInteractive) {
        event.preventDefault();
        onTogglePrimaryTimer();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onScanQr, onCopySummary, onSync, onExport, onTogglePrimaryTimer]);

  const filtered = rows.filter(
    (r) =>
      r.bib.toLowerCase().includes(query.toLowerCase()) ||
      r.name.toLowerCase().includes(query.toLowerCase())
  );

  const controlsContent = (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onScanQr}
        className="min-h-11 w-full px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
      >
        <QrCode className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>Scan Race Bib QR (F1)</span>
      </button>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (manualBib.trim()) onAssignChip(manualBib.trim());
        }}
        className="flex flex-col gap-2 p-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-page)]"
      >
        <label htmlFor="manual-bib-input" className="text-xs font-semibold text-[var(--text-secondary)]">
          Manual Bib / Chip Assignment
        </label>
        <div className="flex items-center gap-2">
          <input
            id="manual-bib-input"
            value={manualBib}
            onChange={(e) => setManualBib(e.target.value)}
            placeholder="Bib #"
            className="min-h-11 lg:min-h-9 flex-1 px-3 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] text-sm font-mono tabular-nums"
          />
          <button
            type="submit"
            className="min-h-11 lg:min-h-9 px-3 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] text-sm font-semibold"
          >
            Assign
          </button>
        </div>
      </form>

      <div className="pt-3 border-t border-[var(--border-default)] flex items-center justify-between gap-2">
        {!resetArmed ? (
          <button
            type="button"
            onClick={() => setResetArmed(true)}
            className="min-h-11 px-3 rounded-lg border border-red-600/40 text-red-600 text-sm font-semibold inline-flex items-center gap-2"
          >
            <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Reset Local Reads</span>
          </button>
        ) : (
          <div className="flex items-center gap-2 w-full">
            <button
              type="button"
              onClick={() => setResetArmed(false)}
              className="min-h-11 flex-1 rounded-lg border border-[var(--border-default)] text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setResetArmed(false);
                onConfirmedReset();
              }}
              className="min-h-11 flex-1 rounded-lg bg-red-600 text-white text-sm font-semibold"
            >
              Confirm Reset
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="w-full min-h-[100dvh] lg:h-screen lg:overflow-hidden flex flex-col bg-[var(--surface-page)] text-[var(--text-primary)]">
      {/* Top consolidated bar: 48px mobile sticky, <= 52px desktop */}
      <header className="sticky top-0 z-20 lg:static h-12 lg:h-[52px] shrink-0 px-3 lg:px-4 border-b border-[var(--border-default)] bg-[var(--surface-card)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold truncate">RacePulsePH</span>
          <span className="hidden sm:inline text-xs text-[var(--text-secondary)]">/</span>
          <h1 className="hidden sm:inline text-sm font-semibold truncate">Timing Console</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="global-race-select" className="sr-only">Active race</label>
          <select
            id="global-race-select"
            value={selectedRaceId}
            onChange={(e) => onSelectRace(e.target.value)}
            className="h-9 lg:h-8 max-w-[160px] sm:max-w-xs px-2 rounded-md border border-[var(--border-default)] bg-[var(--surface-page)] text-xs sm:text-sm"
          >
            {races.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setTelemetryOpen((v) => !v)}
            aria-expanded={telemetryOpen}
            className="lg:hidden min-h-11 px-2.5 rounded-md border border-[var(--border-default)] text-xs font-semibold inline-flex items-center gap-1"
          >
            <span>Stats</span>
            <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onSync}
            aria-label="Sync local station (F3)"
            title="Sync local station (F3)"
            className="hidden lg:inline-flex h-8 px-3 rounded-md border border-[var(--border-default)] text-xs font-semibold items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Sync (F3)</span>
          </button>
        </div>
      </header>

      {/* Collapsible mobile telemetry drawer */}
      {telemetryOpen && (
        <section aria-label="Mobile telemetry summary" className="lg:hidden px-3 py-2 border-b border-[var(--border-default)] bg-[var(--surface-card)] grid grid-cols-3 gap-2 text-xs">
          <div><span className="block text-[var(--text-secondary)]">LAN</span><strong className="font-semibold">{lanConnected ? 'Online' : 'Offline'}</strong></div>
          <div><span className="block text-[var(--text-secondary)]">Queue</span><strong className="font-mono tabular-nums">{pendingQueue}</strong></div>
          <div><span className="block text-[var(--text-secondary)]">Clock</span><strong className="font-mono tabular-nums">{elapsedClock}</strong></div>
        </section>
      )}

      {/* Desktop read-only telemetry ribbon (<= 40px) */}
      <section aria-label="Telemetry ribbon" className="hidden lg:flex h-10 shrink-0 px-4 border-b border-[var(--border-default)] bg-[var(--surface-card)] items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-4">
          <span className="font-semibold">{lanConnected ? 'LAN Ready' : 'LAN Offline'}</span>
          <span className="font-mono tabular-nums">Participants: <strong>{rows.length}</strong></span>
          <span className="font-mono tabular-nums">Offline Queue: <strong>{pendingQueue}</strong></span>
        </div>
        <span className="font-mono tabular-nums text-sm font-semibold">{elapsedClock}</span>
      </section>

      {/* Main workspace: Desktop 64%/36% split, Mobile single-column list */}
      <main className="flex-1 min-h-0 flex flex-col lg:flex-row lg:overflow-hidden">
        <section aria-label="Participant queue" className="flex-1 min-h-0 lg:w-[64%] flex flex-col lg:border-r border-[var(--border-default)]">
          <div className="shrink-0 p-3 border-b border-[var(--border-default)] flex items-center gap-2">
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search runners by bib or name"
              placeholder="Search bib or runner (Ctrl+F)"
              className="min-h-11 lg:min-h-9 flex-1 px-3 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] text-sm"
            />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto pb-24 lg:pb-0">
            {/* Desktop full-width dense table */}
            <table className="hidden lg:table w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-[var(--surface-card)] border-b border-[var(--border-default)] text-xs font-semibold">
                <tr>
                  <th className="py-2 px-3 w-24">Bib</th>
                  <th className="py-2 px-3">Runner</th>
                  <th className="py-2 px-3">Category</th>
                  <th className="py-2 px-3 text-right">Official Time</th>
                  <th className="py-2 px-3 w-32 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)] text-sm">
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 px-3 font-mono tabular-nums font-semibold">{r.bib}</td>
                    <td className="py-2 px-3 font-semibold">{r.name}</td>
                    <td className="py-2 px-3 text-[var(--text-secondary)]">{r.category}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{r.officialTime}</td>
                    <td className="py-2 px-3 text-right text-xs font-semibold">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile 2-line card-row hybrid */}
            <ul className="lg:hidden p-3 flex flex-col gap-2">
              {filtered.map((r) => (
                <li key={r.id} className="p-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono tabular-nums font-semibold text-sm">#{r.bib}</span>
                      <span className="font-semibold text-sm truncate">{r.name}</span>
                    </div>
                    <span className="text-xs font-semibold shrink-0">{r.status}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
                    <span>{r.category}</span>
                    <span className="font-mono tabular-nums">{r.officialTime}</span>
                    <button
                      type="button"
                      onClick={() => onAssignChip(r.bib)}
                      className="min-h-11 px-3 rounded-md border border-[var(--border-default)] text-xs font-semibold text-[var(--text-primary)]"
                    >
                      Assign Chip
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Desktop persistent 36% right-hand dock */}
        <aside aria-label="Station controls" className="hidden lg:flex lg:w-[36%] lg:min-h-0 flex-col p-4 overflow-y-auto bg-[var(--surface-card)]">
          <h2 className="text-sm font-semibold mb-3">Hardware & Station Controls</h2>
          {controlsContent}
        </aside>
      </main>

      {/* Mobile sticky thumb-zone bottom bar */}
      <div className="lg:hidden fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border-default)] bg-[var(--surface-card)] px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMobileControlsOpen(true)}
          className="min-h-11 px-4 rounded-lg border border-[var(--border-default)] text-sm font-semibold inline-flex items-center gap-2 shrink-0"
        >
          <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
          <span>Controls</span>
        </button>
        <button
          type="button"
          onClick={onScanQr}
          className="min-h-11 flex-1 rounded-lg bg-red-600 text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
        >
          <QrCode className="w-4 h-4" aria-hidden="true" />
          <span>Scan Race Bib QR</span>
        </button>
      </div>

      {/* Mobile bottom-sheet modal (use DialogSurface portal in RacePulsePH) */}
      {mobileControlsOpen && (
        <div role="dialog" aria-modal="true" aria-label="Station controls" className="lg:hidden fixed inset-0 z-40 bg-black/50 flex items-end">
          <div className="w-full rounded-t-2xl bg-[var(--surface-card)] border-t border-[var(--border-default)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold">Station Controls</h2>
              <button
                type="button"
                onClick={() => setMobileControlsOpen(false)}
                aria-label="Close station controls"
                className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg border border-[var(--border-default)]"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            {controlsContent}
          </div>
        </div>
      )}
    </div>
  );
}
```

## ADR (Architecture Decision Record) Summary Template

- **Decision:** Lock desktop operator console to `100vh` with a `64%` / `36%` master-detail split, `<= 52px` top bar, and `<= 40px` read-only telemetry ribbon; linearize mobile viewports (`390x844`) into `100dvh` 2-line hybrid cards with a `48px` collapsible header, bottom-sheet controls, and a sticky `bottom-0` thumb dock.
- **Standards Satisfied:** ISO 11064-4, ISO 11064-5, ISO 9241-110, ISO 9241-112, ISO 9241-115, ISO 9241-125, ISO 9241-161, ISO/IEC 11581-10, ISO 9241-920, ISO/IEC 25010.
- **Consequences:** Eliminates vertical scroll bloat and lateral dead zones on timing laptops (`1366x768` / `1920x1080`) while guaranteeing `>= 44x44px` thumb reachability on field smartphones without removing any operator action.
