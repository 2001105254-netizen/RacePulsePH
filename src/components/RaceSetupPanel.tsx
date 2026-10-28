import { useAccess, useScopedRaces, authenticatedFetch } from '../lib/access';
import React, { useEffect, useRef, useState } from 'react';
import { collection, doc, onSnapshot, setDoc, updateDoc, deleteField, deleteDoc, getDocs, query, runTransaction, where, writeBatch } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import { resizeImageToDataUrl, resizeImageToDataUrlContain } from '../lib/image';
import { AgeCategory, CheckpointType, Gender, Race, RaceBibCustomFont, RaceBibFont, RaceBibTemplate, RaceDistance, RaceEntryCategory, RunnerProfile, UserProfile } from '../types';
import { entryCategoryLabels, raceEntryCategories } from '../lib/raceEntry';
import { generateRunnerRosterPdf } from '../lib/runnerReport';
import { generateRaceBibsPdf } from '../lib/raceBibPdf';
import { hasRaceBibTemplate } from '../lib/raceBib';
import { ensureRaceBibCustomFont, raceBibFontFamily } from '../lib/raceBibFont';
import { QRCodeSVG } from 'qrcode.react';
import { Flag, Trash2, Plus, Save, Pencil, RefreshCw, Users2, FileDown, ImagePlus, X, QrCode, Copy, Download } from 'lucide-react';

interface CheckpointDraft {
  id: string;
  label: string;
  type: CheckpointType;
  cutoffMinutes: string;
}

function emptyCheckpointDrafts(): CheckpointDraft[] {
  return [
    { id: 'checkin', label: 'Check-In', type: 'checkin', cutoffMinutes: '' },
    { id: 'start', label: 'Start', type: 'start', cutoffMinutes: '' },
    { id: 'finish', label: 'Finish', type: 'finish', cutoffMinutes: '' },
  ];
}

interface AgeCategoryDraft {
  id: string;
  gender: Gender;
  minAge: number;
  maxAge: number;
  // The gender is prepended automatically, e.g. “Male 20 & Below”.
  labelSuffix: string;
}

function draftToAgeCategory(d: AgeCategoryDraft): AgeCategory {
  const genderLabel = d.gender === 'male' ? 'Male' : 'Female';
  const rangeLabel = d.labelSuffix.trim() || `${d.minAge}-${d.maxAge}`;
  return { id: d.id, gender: d.gender, minAge: d.minAge, maxAge: d.maxAge, label: `${genderLabel} ${rangeLabel}` };
}

function ageCategoryLabelSuffix(category: AgeCategory): string {
  return category.label.replace(/^(Male|Female)\s+/i, '') || `${category.minAge}-${category.maxAge}`;
}

interface DistanceDraft {
  id: string;
  km: number;
  price: number;
}

function draftToDistance(d: DistanceDraft): RaceDistance {
  return { id: d.id, km: d.km, price: d.price, label: `${d.km}K` };
}

interface InclusionDraft {
  id: string;
  text: string;
}

function formatPriceRange(distances: RaceDistance[] | undefined): string {
  if (!distances || distances.length === 0) return 'No pricing set';
  const prices = distances.map((d) => d.price || 0);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? `₱${min.toFixed(0)}` : `₱${min.toFixed(0)}-₱${max.toFixed(0)}`;
}

function freeSlotCounterId(raceId: string, distanceLabel: string, entryCategory: RaceEntryCategory): string {
  // Free slots intentionally share the matching category counter with normal
  // registrations. That keeps Solo, Duo, Trio, and Group bibs unique.
  return `${raceId}_${distanceLabel}_${entryCategory}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function normalizeBib(value: string): string {
  return value.trim().replace(/^#\s*/, '').replace(/\s+/g, '').toUpperCase();
}

async function reserveFreeSlotBibs(race: Race, distance: RaceDistance, entryCategory: RaceEntryCategory, count: number, usedBibs: Set<string>): Promise<string[]> {
  const counterRef = doc(db, 'bibCounters', freeSlotCounterId(race.id, distance.label, entryCategory));
  return runTransaction(db, async (transaction) => {
    const counter = await transaction.get(counterRef);
    let sequence = Number(counter.exists() ? counter.data().count : 0) || 0;
    const bibs: string[] = [];
    while (bibs.length < count) {
      sequence += 1;
      const suffix = entryCategory === 'duo' ? 'D' : entryCategory === 'trio' ? 'T' : entryCategory === 'group' ? 'G' : '';
      const prefix = suffix ? `${distance.km}-${suffix}` : String(distance.km);
      const bib = `${prefix}-${String(sequence).padStart(3, '0')}`;
      if (!usedBibs.has(normalizeBib(bib))) {
        usedBibs.add(normalizeBib(bib));
        bibs.push(bib);
      }
    }
    transaction.set(counterRef, { count: sequence, raceId: race.id });
    return bibs;
  });
}

interface RaceSetupPanelProps {
  uid: string;
  // Admin sees/edits every organizer's races; an Organizer only sees/edits their own.
  canSeeAllRaces: boolean;
  canDeleteRaces: boolean;
}

// Shared by both the Admin "Race Setup" tab and the Organizer dashboard - organizers
// need to be able to stand up a race day-of without waiting on an Admin.
export default function RaceSetupPanel({ uid, canSeeAllRaces, canDeleteRaces }: RaceSetupPanelProps) {
  const { can, authority, version } = useAccess();
  const settingsAllowed = ['race.edit','race.categories','race.registration','race.artwork','race.bibs','race.team','payment.configure'].some(can);
  const races = useScopedRaces();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [registrationCloseDate, setRegistrationCloseDate] = useState('');
  const [onlinePaymentEnabled, setOnlinePaymentEnabled] = useState(false);
  const [paymentFeeMode, setPaymentFeeMode] = useState<'absorbed' | 'passed_on'>('absorbed');
  const [manualPaymentEnabled, setManualPaymentEnabled] = useState(false);
  const [manualPaymentInstructions, setManualPaymentInstructions] = useState('');
  const [manualPaymentQrImage, setManualPaymentQrImage] = useState('');
  const [manualPaymentQrUploading, setManualPaymentQrUploading] = useState(false);
  const [organizerIds, setOrganizerIds] = useState<string[]>([]);
  const [approvedOrganizers, setApprovedOrganizers] = useState<UserProfile[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointDraft[]>(emptyCheckpointDrafts());
  const [ageCategories, setAgeCategories] = useState<AgeCategoryDraft[]>([]);
  const [distances, setDistances] = useState<DistanceDraft[]>([]);
  const [entryCategories, setEntryCategories] = useState<RaceEntryCategory[]>(['solo']);
  const [inclusions, setInclusions] = useState<InclusionDraft[]>([]);
  const [posterImage, setPosterImage] = useState('');
  const [posterUploading, setPosterUploading] = useState(false);
  const [inclusionImage, setInclusionImage] = useState('');
  const [inclusionUploading, setInclusionUploading] = useState(false);
  const [raceBibTemplateImage, setRaceBibTemplateImage] = useState('');
  const [raceBibTemplatesByDistance, setRaceBibTemplatesByDistance] = useState<Record<string, RaceBibTemplate>>({});
  const [raceBibUploading, setRaceBibUploading] = useState(false);
  const [raceBibCustomFont, setRaceBibCustomFont] = useState<RaceBibCustomFont | undefined>(undefined);
  const [raceBibFontUploading, setRaceBibFontUploading] = useState(false);
  const [bibNumberX, setBibNumberX] = useState(50);
  const [bibNumberY, setBibNumberY] = useState(48);
  const [runnerNameX, setRunnerNameX] = useState(50);
  const [runnerNameY, setRunnerNameY] = useState(70);
  const [bibNumberSize, setBibNumberSize] = useState(12);
  const [runnerNameSize, setRunnerNameSize] = useState(5);
  const [bibNumberColor, setBibNumberColor] = useState('#FFFFFF');
  const [runnerNameColor, setRunnerNameColor] = useState('#FFFFFF');
  const [bibNumberStrokeColor, setBibNumberStrokeColor] = useState('#000000');
  const [runnerNameStrokeColor, setRunnerNameStrokeColor] = useState('#000000');
  const [bibNumberStrokeWidth, setBibNumberStrokeWidth] = useState(0);
  const [runnerNameStrokeWidth, setRunnerNameStrokeWidth] = useState(0);
  const [bibNumberFont, setBibNumberFont] = useState<RaceBibFont>('mono');
  const [runnerNameFont, setRunnerNameFont] = useState<RaceBibFont>('display');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reportBusyRaceId, setReportBusyRaceId] = useState<string | null>(null);
  const [raceBibPdfBusyRaceId, setRaceBibPdfBusyRaceId] = useState<string | null>(null);
  const [bibDownloadRace, setBibDownloadRace] = useState<Race | null>(null);
  const [qrRace, setQrRace] = useState<Race | null>(null);
  const [freeSlotRace, setFreeSlotRace] = useState<Race | null>(null);
  const posterInputRef = useRef<HTMLInputElement>(null);
  const inclusionInputRef = useRef<HTMLInputElement>(null);
  const raceBibInputRef = useRef<HTMLInputElement>(null);
  const raceBibFontInputRef = useRef<HTMLInputElement>(null);
  const raceBibDistanceInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const manualPaymentQrInputRef = useRef<HTMLInputElement>(null);
  const registrationQrRef = useRef<SVGSVGElement>(null);



  useEffect(() => {
    if (!can('race.team')) { setApprovedOrganizers([]); return; }
    const organizersQuery = query(
      collection(db, 'users'),
      where('role', '==', 'organizer'),
      where('approved', '==', true),
    );
    return onSnapshot(organizersQuery, (snapshot) => {
      const list = snapshot.docs
        .map((docSnap) => docSnap.data() as UserProfile)
        .filter((organizer) => organizer.uid !== uid)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      setApprovedOrganizers(list);
    }, (err) => console.warn('Organizer team directory listener failed:', err.message));
  }, [uid]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setDate(new Date().toISOString().slice(0, 10));
    setRegistrationOpen(true);
    setRegistrationCloseDate('');
    setOnlinePaymentEnabled(false);
    setPaymentFeeMode('absorbed');
    setManualPaymentEnabled(false);
    setManualPaymentInstructions('');
    setManualPaymentQrImage('');
    setOrganizerIds([]);
    setCheckpoints(emptyCheckpointDrafts());
    setAgeCategories([]);
    setDistances([]);
    setEntryCategories(['solo']);
    setInclusions([]);
    setPosterImage('');
    setInclusionImage('');
    setRaceBibTemplateImage('');
    setRaceBibTemplatesByDistance({});
    setRaceBibCustomFont(undefined);
    setBibNumberX(50);
    setBibNumberY(48);
    setRunnerNameX(50);
    setRunnerNameY(70);
    setBibNumberSize(12);
    setRunnerNameSize(5);
    setBibNumberColor('#FFFFFF');
    setRunnerNameColor('#FFFFFF');
    setBibNumberStrokeColor('#000000');
    setRunnerNameStrokeColor('#000000');
    setBibNumberStrokeWidth(0);
    setRunnerNameStrokeWidth(0);
    setBibNumberFont('mono');
    setRunnerNameFont('display');
    setError('');
  };

  useEffect(() => {
    window.addEventListener('racepulse:back', resetForm);
    return () => window.removeEventListener('racepulse:back', resetForm);
  }, []);

  const loadForEdit = (race: Race) => {
    setEditingId(race.id);
    setName(race.name);
    setDate(race.date);
    setRegistrationOpen(race.registrationOpen !== false);
    setRegistrationCloseDate(race.registrationCloseDate || '');
    setOnlinePaymentEnabled(race.onlinePaymentEnabled === true);
    setPaymentFeeMode(race.paymentFeeMode || 'absorbed');
    setManualPaymentEnabled(race.manualPaymentEnabled === true);
    setManualPaymentInstructions(race.manualPaymentInstructions || '');
    setManualPaymentQrImage(race.manualPaymentQrImage || '');
    setOrganizerIds((race.organizerIds || []).filter((organizerId) => organizerId !== race.createdBy));
    const ordered = [...race.checkpoints].sort((a, b) => a.order - b.order);
    setCheckpoints(ordered.map((c, index) => ({
      id: c.id,
      label: c.label,
      type: c.type || (index === 0 ? 'start' : index === ordered.length - 1 ? 'finish' : 'intermediate'),
      cutoffMinutes: c.cutoffMinutes ? String(c.cutoffMinutes) : '',
    })));
    setAgeCategories((race.ageCategories || []).map((c) => ({ id: c.id, gender: c.gender, minAge: c.minAge, maxAge: c.maxAge, labelSuffix: ageCategoryLabelSuffix(c) })));
    setDistances((race.distances || []).sort((a, b) => a.km - b.km).map((d) => ({ id: d.id, km: d.km, price: d.price || 0 })));
    setEntryCategories(raceEntryCategories(race));
    setInclusions((race.inclusions || []).map((text, idx) => ({ id: `incl_${idx}_${Date.now()}`, text })));
    setPosterImage(race.posterImage || '');
    setInclusionImage(race.inclusionImage || '');
    setRaceBibTemplateImage(race.raceBibTemplateImage || '');
    setRaceBibTemplatesByDistance(race.raceBibTemplatesByDistance || {});
    setRaceBibCustomFont(race.raceBibCustomFont);
    void ensureRaceBibCustomFont(race.raceBibCustomFont).catch((err) => console.warn('Unable to load custom race bib font:', err));
    setBibNumberX(race.raceBibLayout?.bibNumberX ?? 50);
    setBibNumberY(race.raceBibLayout?.bibNumberY ?? 48);
    setRunnerNameX(race.raceBibLayout?.runnerNameX ?? 50);
    setRunnerNameY(race.raceBibLayout?.runnerNameY ?? 70);
    setBibNumberSize(race.raceBibLayout?.bibNumberSize ?? 12);
    setRunnerNameSize(race.raceBibLayout?.runnerNameSize ?? 5);
    setBibNumberColor(race.raceBibLayout?.bibNumberColor ?? '#FFFFFF');
    setRunnerNameColor(race.raceBibLayout?.runnerNameColor ?? '#FFFFFF');
    setBibNumberStrokeColor(race.raceBibLayout?.bibNumberStrokeColor ?? '#000000');
    setRunnerNameStrokeColor(race.raceBibLayout?.runnerNameStrokeColor ?? '#000000');
    setBibNumberStrokeWidth(race.raceBibLayout?.bibNumberStrokeWidth ?? 0);
    setRunnerNameStrokeWidth(race.raceBibLayout?.runnerNameStrokeWidth ?? 0);
    setBibNumberFont(race.raceBibLayout?.bibNumberFont ?? 'mono');
    setRunnerNameFont(race.raceBibLayout?.runnerNameFont ?? 'display');
    setError('');
  };

  const handlePosterSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPosterUploading(true);
    setError('');
    try {
      const dataUrl = await resizeImageToDataUrl(file, 800, 450, 0.78);
      setPosterImage(dataUrl);
    } catch (err: any) {
      setError(err.message || 'Failed to process the poster image.');
    } finally {
      setPosterUploading(false);
    }
  };

  const handleInclusionImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setInclusionUploading(true);
    setError('');
    try {
      setInclusionImage(await resizeImageToDataUrlContain(file, 1000, 1000, 0.82));
    } catch (err: any) {
      setError(err.message || 'Failed to process the inclusion image.');
    } finally {
      setInclusionUploading(false);
    }
  };

  const handleRaceBibTemplateSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setRaceBibUploading(true);
    setError('');
    try {
      // The race-bib PDF places two landscape bibs on one A4 sheet. Keep the
      // uploaded artwork at the same 3:2 ratio used by that print layout.
      setRaceBibTemplateImage(await resizeImageToDataUrl(file, 1200, 800, 0.82));
    } catch (err: any) {
      setError(err.message || 'Failed to process the race bib template.');
    } finally {
      setRaceBibUploading(false);
    }
  };

  const handleDistanceRaceBibTemplateSelected = async (distanceLabel: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setRaceBibUploading(true);
    setError('');
    try {
      const image = await resizeImageToDataUrl(file, 1200, 800, 0.82);
      setRaceBibTemplatesByDistance((current) => ({ ...current, [distanceLabel]: { image } }));
    } catch (err: any) {
      setError(err.message || `Failed to process the ${distanceLabel} race bib template.`);
    } finally {
      setRaceBibUploading(false);
    }
  };

  const handleRaceBibFontSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!extension || !['woff2', 'woff', 'ttf', 'otf'].includes(extension)) {
      setError('Upload a font file in WOFF2, WOFF, TTF, or OTF format.');
      return;
    }
    if (file.size > 1_500_000) {
      setError('Keep the custom font under 1.5 MB. WOFF2 is recommended for the best print and download speed.');
      return;
    }
    setRaceBibFontUploading(true);
    setError('');
    try {
      const stamp = Date.now();
      const family = `RacePulseCustom_${stamp}`;
      const path = `race-bib-fonts/${uid}/${stamp}.${extension}`;
      const fontRef = storageRef(storage, path);
      await uploadBytes(fontRef, file, { contentType: file.type || 'font/woff2' });
      const customFont: RaceBibCustomFont = { family, url: await getDownloadURL(fontRef), name: file.name };
      await ensureRaceBibCustomFont(customFont);
      setRaceBibCustomFont(customFont);
    } catch (err: any) {
      console.warn('Failed to upload custom race bib font:', err);
      setError(err.message || 'Could not upload the custom font. Please try again.');
    } finally {
      setRaceBibFontUploading(false);
    }
  };

  const handleManualPaymentQrSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file for the payment QR code.');
      return;
    }
    setManualPaymentQrUploading(true);
    setError('');
    try {
      // Keep the whole QR square intact and small enough for a Firestore race doc.
      setManualPaymentQrImage(await resizeImageToDataUrlContain(file, 640, 640, 0.92));
    } catch (err: any) {
      setError(err.message || 'Failed to process the payment QR image.');
    } finally {
      setManualPaymentQrUploading(false);
    }
  };

  const addCheckpoint = () => setCheckpoints((prev) => [...prev.slice(0, -1), { id: `cp_${Date.now()}`, label: '', type: 'intermediate', cutoffMinutes: '' }, prev[prev.length - 1]]);
  const removeCheckpoint = (idx: number) => setCheckpoints((prev) => prev.filter((_, i) => i !== idx));
  const updateCheckpoint = (idx: number, patch: Partial<CheckpointDraft>) =>
    setCheckpoints((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));

  const addAgeCategory = () =>
    setAgeCategories((prev) => [...prev, { id: `age_${Date.now()}`, gender: 'male', minAge: 18, maxAge: 29, labelSuffix: '18-29' }]);
  const addAgeCategoryPreset = (minAge: number, maxAge: number, labelSuffix: string) => {
    setAgeCategories((prev) => {
      const next = [...prev];
      (['male', 'female'] as Gender[]).forEach((gender) => {
        if (!next.some((category) => category.gender === gender && category.minAge === minAge && category.maxAge === maxAge)) {
          next.push({ id: `age_${gender}_${minAge}_${maxAge}_${Date.now()}`, gender, minAge, maxAge, labelSuffix });
        }
      });
      return next;
    });
  };
  const removeAgeCategory = (idx: number) => setAgeCategories((prev) => prev.filter((_, i) => i !== idx));
  const updateAgeCategory = (idx: number, patch: Partial<AgeCategoryDraft>) =>
    setAgeCategories((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));

  const addDistance = () => setDistances((prev) => [...prev, { id: `dist_${Date.now()}`, km: 5, price: 0 }]);
  const removeDistance = (idx: number) => setDistances((prev) => prev.filter((_, i) => i !== idx));
  const updateDistanceKm = (idx: number, km: number) =>
    setDistances((prev) => prev.map((d, i) => (i === idx ? { ...d, km } : d)));
  const updateDistancePrice = (idx: number, price: number) =>
    setDistances((prev) => prev.map((d, i) => (i === idx ? { ...d, price } : d)));

  const addInclusion = () => setInclusions((prev) => [...prev, { id: `incl_${Date.now()}`, text: '' }]);
  const removeInclusion = (idx: number) => setInclusions((prev) => prev.filter((_, i) => i !== idx));
  const updateInclusionText = (idx: number, text: string) =>
    setInclusions((prev) => prev.map((i, idx2) => (idx2 === idx ? { ...i, text } : i)));

  // Images used to be embedded as base64 strings in the race document. A few
  // separate bib designs can easily push a Firestore document past its 1 MiB
  // limit, so keep the files in Storage and retain only their download URLs.
  // Existing base64 artwork is migrated the next time its race is saved.
  const storeRaceImage = async (image: string, raceId: string, assetName: string): Promise<string> => {
    const permission = assetName.startsWith('bib-') ? 'race.bibs' : assetName === 'payment-qr' ? 'payment.configure' : 'race.artwork';
    if (editingId && !can(permission)) return image;
    if (!image || !image.startsWith('data:')) return image;

    const response = await fetch(image);
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error('The selected race artwork is not a valid image.');

    const safeName = assetName.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    const fileRef = storageRef(storage, `race-assets/${uid}/${raceId}/${safeName}-${Date.now()}.jpg`);
    await uploadBytes(fileRef, blob, {
      contentType: blob.type || 'image/jpeg',
      cacheControl: 'public,max-age=31536000,immutable',
    });
    return getDownloadURL(fileRef);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId && !can('race.create')) return setError('Race creation is disabled for your account.');
    setError('');
    if (!name.trim()) return setError('Race name is required.');
    if (checkpoints.length < 2) return setError('At least a Start and Finish checkpoint are required.');
    if (checkpoints.some((c) => !c.label.trim())) return setError('Every checkpoint needs a label.');
    if (checkpoints.filter((c) => c.type === 'start').length !== 1) return setError('Exactly one Start checkpoint is required.');
    if (checkpoints.filter((c) => c.type === 'finish').length !== 1) return setError('Exactly one Finish checkpoint is required.');
    if (checkpoints.filter((c) => c.type === 'checkin').length > 1) return setError('Only one Check-In checkpoint is allowed.');
    if (checkpoints.some((c) => c.type === 'intermediate' && c.cutoffMinutes && (!Number.isFinite(Number(c.cutoffMinutes)) || Number(c.cutoffMinutes) <= 0))) return setError('Intermediate cutoff minutes must be greater than zero.');
    const startIndex = checkpoints.findIndex((c) => c.type === 'start');
    const finishIndex = checkpoints.findIndex((c) => c.type === 'finish');
    const checkInIndex = checkpoints.findIndex((c) => c.type === 'checkin');
    if (finishIndex < startIndex) return setError('Finish must come after Start.');
    if (checkInIndex !== -1 && checkInIndex > startIndex) return setError('Check-In must come before Start.');
    if (checkpoints.some((checkpoint, index) => checkpoint.type === 'intermediate' && (index < startIndex || index > finishIndex))) return setError('Intermediate checkpoints must be between Start and Finish.');
    if (ageCategories.some((c) => c.minAge > c.maxAge)) return setError('An age category\'s minimum age cannot be greater than its maximum.');
    if (distances.some((d) => !d.km || d.km <= 0)) return setError('Every distance needs a kilometer value greater than 0.');
    if (distances.some((d) => d.price < 0)) return setError('A distance\'s price cannot be negative.');
    if (entryCategories.length === 0) return setError('Choose at least one entry category.');
    if (registrationCloseDate && registrationCloseDate > date) return setError('Registration closing date cannot be after the race date.');
    if ((onlinePaymentEnabled || manualPaymentEnabled) && !distances.some((distance) => distance.price > 0)) return setError('Set a price on at least one distance before enabling payment.');
    if (manualPaymentEnabled && !manualPaymentInstructions.trim()) return setError('Add payment instructions for runners (for example, Cash, GCash, or bank-transfer details).');

    setSaving(true);
    try {
      const raceId = editingId || `race_${Date.now()}`;
      const existing = editingId ? races.find((r) => r.id === editingId) : undefined;
      const primaryOrganizerId = existing?.createdBy || uid;
      const teamOrganizerIds = [...new Set(organizerIds)]
        .filter((organizerId) => organizerId && organizerId !== primaryOrganizerId)
        .slice(0, 20);
      const savedDistances = [...distances].sort((a, b) => a.km - b.km).map(draftToDistance);
      const [storedPosterImage, storedInclusionImage, storedManualPaymentQrImage, storedRaceBibTemplateImage] = await Promise.all([
        storeRaceImage(posterImage, raceId, 'poster'),
        storeRaceImage(inclusionImage, raceId, 'inclusion'),
        storeRaceImage(manualPaymentQrImage, raceId, 'payment-qr'),
        storeRaceImage(raceBibTemplateImage, raceId, 'bib-default'),
      ]);
      // Ignore templates from a distance that an organizer has removed before
      // saving. Matching uses the runner's stored distance label, e.g. "12K".
      // Upload only fresh base64 data; already-stored asset URLs are retained.
      const savedDistanceBibTemplates = Object.fromEntries(await Promise.all(
        savedDistances
          .filter((distance) => raceBibTemplatesByDistance[distance.label]?.image)
          .map(async (distance) => {
            const template = raceBibTemplatesByDistance[distance.label];
            return [distance.label, {
              ...template,
              image: await storeRaceImage(template.image, raceId, `bib-${distance.label}`),
            }] as const;
          }),
      )) as Record<string, RaceBibTemplate>;
      const record: Race = {
        id: raceId,
        name: name.trim(),
        date,
        registrationOpen,
        onlinePaymentEnabled,
        paymentFeeMode,
        manualPaymentEnabled,
        ...(manualPaymentEnabled ? {
          manualPaymentInstructions: manualPaymentInstructions.trim(),
          ...(storedManualPaymentQrImage ? { manualPaymentQrImage: storedManualPaymentQrImage } : {}),
        } : {}),
        ...(registrationCloseDate ? { registrationCloseDate } : {}),
        checkpoints: checkpoints.map((c, idx) => ({
          id: c.id,
          label: c.label.trim(),
          order: idx,
          type: c.type,
          ...(c.type === 'intermediate' && c.cutoffMinutes ? { cutoffMinutes: Number(c.cutoffMinutes) } : {}),
        })),
        ageCategories: ageCategories.map(draftToAgeCategory),
        distances: savedDistances,
        entryCategories,
        inclusions: inclusions.map((i) => i.text.trim()).filter(Boolean),
        createdBy: primaryOrganizerId,
        ...(teamOrganizerIds.length ? { organizerIds: teamOrganizerIds } : {}),
        createdAt: existing?.createdAt || new Date().toISOString(),
        ...(existing?.gunStartTime ? { gunStartTime: existing.gunStartTime } : {}),
        ...(existing?.waveStartTimes ? { waveStartTimes: existing.waveStartTimes } : {}),
        ...(existing?.liveBroadcastEnabled ? { liveBroadcastEnabled: true } : {}),
        ...(existing?.livestreamUrl ? { livestreamUrl: existing.livestreamUrl } : {}),
        ...(existing?.routeMapUrl ? { routeMapUrl: existing.routeMapUrl } : {}),
        ...(storedPosterImage ? { posterImage: storedPosterImage } : {}),
        ...(storedInclusionImage ? { inclusionImage: storedInclusionImage } : {}),
        ...(storedRaceBibTemplateImage ? { raceBibTemplateImage: storedRaceBibTemplateImage } : {}),
        ...(raceBibCustomFont ? { raceBibCustomFont } : {}),
        ...(storedRaceBibTemplateImage || Object.keys(savedDistanceBibTemplates).length ? {
          raceBibLayout: { bibNumberX, bibNumberY, runnerNameX, runnerNameY, bibNumberSize, runnerNameSize, bibNumberColor, runnerNameColor, bibNumberStrokeColor, runnerNameStrokeColor, bibNumberStrokeWidth, runnerNameStrokeWidth, bibNumberFont, runnerNameFont },
        } : {}),
        ...(Object.keys(savedDistanceBibTemplates).length ? { raceBibTemplatesByDistance: savedDistanceBibTemplates } : {}),
      };
      if (existing) {
        // Patch only changed settings; never overwrite a concurrent start, finish or publication.
        const operational = ['gunStartTime','waveStartTimes','completedAt','liveBroadcastEnabled','livestreamUrl','routeMapUrl','id','createdBy','createdAt'];
        const patch: Record<string, unknown> = {};
        for (const key of new Set([...Object.keys(existing), ...Object.keys(record)])) {
          if (!operational.includes(key) && JSON.stringify(existing[key]) !== JSON.stringify(record[key])) patch[key] = record[key] === undefined ? deleteField() : record[key];
        }
        if (Object.keys(patch).length) await updateDoc(doc(db, 'races', raceId), patch);
      } else await setDoc(doc(db, 'races', raceId), record);
      resetForm();
    } catch (err: any) {
      setError(err.message || 'Failed to save race.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (raceId: string) => {
    if (!window.confirm('Delete this race? Already-recorded chip reads are kept but will be orphaned.')) return;
    try {
      await deleteDoc(doc(db, 'races', raceId));
      if (editingId === raceId) resetForm();
    } catch (err) {
      console.warn('Failed to delete race:', err);
    }
  };

  const handleGenerateRunnerReport = async (race: Race) => {
    setReportBusyRaceId(race.id);
    try {
      const snapshot = await getDocs(query(collection(db, 'runners'), where('raceId', '==', race.id)));
      const runners: RunnerProfile[] = [];
      snapshot.forEach((docSnap) => runners.push(docSnap.data() as RunnerProfile));

      if (!generateRunnerRosterPdf(race, runners)) {
        alert('No registered runners for this race yet.');
      }
    } catch (err) {
      console.warn('Failed to generate runner report:', err);
      alert('Failed to generate the runner report. Please try again.');
    } finally {
      setReportBusyRaceId(null);
    }
  };

  const handleGenerateRaceBibs = async (race: Race, distanceLabel?: string) => {
    if (!hasRaceBibTemplate(race)) {
      alert('Upload and save at least one blank race bib layout first. You can set a different layout for every distance.');
      return;
    }
    setRaceBibPdfBusyRaceId(race.id);
    try {
      const snapshot = await getDocs(query(collection(db, 'runners'), where('raceId', '==', race.id)));
      const runners: RunnerProfile[] = [];
      snapshot.forEach((docSnap) => runners.push(docSnap.data() as RunnerProfile));
      const selectedRunners = distanceLabel ? runners.filter((runner) => runner.distance === distanceLabel) : runners;
      const count = await generateRaceBibsPdf(race, selectedRunners, distanceLabel);
      if (!count) alert(distanceLabel ? `No registered runners for ${distanceLabel} yet.` : 'No registered runners for this race yet.');
    } catch (err) {
      console.warn('Failed to generate race bib PDF:', err);
      const detail = err instanceof Error ? err.message : 'Please try again.';
      alert(`Failed to prepare the ${distanceLabel || 'all-race-bibs'} PDF. ${detail}`);
    } finally {
      setRaceBibPdfBusyRaceId(null);
    }
  };

  const registrationUrl = (raceId: string) => `https://racepulseph.com/?register=${encodeURIComponent(raceId)}`;

  const copyRegistrationUrl = async () => {
    if (!qrRace) return;
    try {
      await navigator.clipboard.writeText(registrationUrl(qrRace.id));
    } catch {
      window.prompt('Copy this event registration link:', registrationUrl(qrRace.id));
    }
  };

  const downloadRegistrationQr = () => {
    if (!qrRace || !registrationQrRef.current) return;
    const source = new XMLSerializer().serializeToString(registrationQrRef.current);
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n${source}`;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${qrRace.name.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '').toLowerCase() || 'race'}-registration-qr.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const editingRace = editingId ? races.find((race) => race.id === editingId) : undefined;
  const canManageOrganizerTeam = can('race.team') && (!editingRace || authority || editingRace.createdBy === uid);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="glass-panel p-5 space-y-4">
        <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2">
          <Flag className="w-4 h-4 text-red-500" /> {editingId ? 'Edit Race' : 'Create Race'}
        </h3>

        <form hidden={!editingId && !can('race.create')} onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Race Name</label>
            <input disabled={(!!editingId && !can('race.edit'))} type="text" required value={name} onChange={(e) => setName(e.target.value)}
              className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" placeholder="EX: ANNUAL MARATHON CHAMPIONSHIP" />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Race Date</label>
            <input disabled={(!!editingId && !can('race.edit'))} type="date" required value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" />
          </div>

          <div className="glass-inset p-3 space-y-3">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span>
                <span className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">Registration status</span>
                <span className="block text-[10.5px] text-[var(--text-muted)] mt-0.5">Only open races appear on the public registration page.</span>
              </span>
              <input disabled={(!!editingId && !can('race.registration'))}
                type="checkbox"
                checked={registrationOpen}
                onChange={(e) => setRegistrationOpen(e.target.checked)}
                className="w-4 h-4 accent-red-600 shrink-0"
              />
            </label>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Registration closes on <span className="normal-case font-normal text-[var(--text-muted)]">(optional)</span></label>
              <input
                type="date"
                value={registrationCloseDate}
                onChange={(e) => setRegistrationCloseDate(e.target.value)}
                disabled={(!registrationOpen) || (!!editingId && !can('race.registration'))}
                className="w-full glass-inset px-3 py-2.5 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:opacity-50"
              />
            </div>
          </div>

          <div className="glass-inset p-3 space-y-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">Organizer team</p>
              <p className="text-[10.5px] text-[var(--text-muted)] mt-0.5">{canManageOrganizerTeam ? 'Add approved organizers who can edit this race, view registrations, assign chips, and run timing. The account that created the race remains the primary owner.' : 'You are a collaborator on this race. The primary organizer manages the organizer team.'}</p>
            </div>
            <select
              value=""
              onChange={(event) => {
                const organizerId = event.target.value;
                if (organizerId) setOrganizerIds((current) => current.includes(organizerId) ? current : [...current, organizerId]);
              }}
              disabled={(!canManageOrganizerTeam || organizerIds.length >= 20) || (!!editingId && !can('race.team'))}
              className="w-full glass-inset px-3 py-2.5 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 disabled:opacity-60"
            >
              <option value="">{approvedOrganizers.length ? 'Add an approved organizer…' : 'No other approved organizer accounts available'}</option>
              {approvedOrganizers
                .filter((organizer) => !organizerIds.includes(organizer.uid))
                .map((organizer) => (
                  <option key={organizer.uid} value={organizer.uid}>{organizer.displayName} — {organizer.email}</option>
                ))}
            </select>
            {organizerIds.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {organizerIds.map((organizerId) => {
                  const organizer = approvedOrganizers.find((candidate) => candidate.uid === organizerId);
                  const label = organizer ? `${organizer.displayName} (${organizer.email})` : `Organizer account ${organizerId.slice(0, 8)}…`;
                  return (
                    <span key={organizerId} className="inline-flex items-center gap-1.5 rounded-full border border-red-500/25 bg-red-500/8 px-2.5 py-1 text-[10px] font-semibold text-[var(--text-primary)]">
                      {label}
                      <button type="button" disabled={(!canManageOrganizerTeam) || (!!editingId && !can('race.team'))} onClick={() => setOrganizerIds((current) => current.filter((id) => id !== organizerId))} className="text-[var(--text-muted)] hover:text-red-500 transition disabled:opacity-40" title={canManageOrganizerTeam ? `Remove ${label}` : 'Only the primary organizer can change the team'}>
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-[10px] text-[var(--text-muted)]">Only you can manage this race right now.</p>
            )}
          </div>

          <div className="glass-inset p-3 space-y-3">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span>
                <span className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">Online payment</span>
                <span className="block text-[10.5px] text-[var(--text-muted)] mt-0.5">Collect paid registrations securely through PayMongo. A bib is issued only after payment is confirmed.</span>
              </span>
              <input disabled={(!!editingId && !can('payment.configure'))}
                type="checkbox"
                checked={onlinePaymentEnabled}
                onChange={(e) => {
                  setOnlinePaymentEnabled(e.target.checked);
                  if (e.target.checked) setManualPaymentEnabled(false);
                }}
                className="w-4 h-4 accent-red-600 shrink-0"
              />
            </label>
            {onlinePaymentEnabled && (
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Payment processing fee</label>
                <select disabled={(!!editingId && !can('payment.configure'))}
                  value={paymentFeeMode}
                  onChange={(e) => setPaymentFeeMode(e.target.value as 'absorbed' | 'passed_on')}
                  className="w-full glass-inset px-3 py-2.5 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                >
                  <option value="absorbed">Organizer absorbs the fee — runner pays the listed price</option>
                  <option value="passed_on">Pass fee to runner — checkout adds PayMongo's fee</option>
                </select>
              </div>
            )}
            <div className="border-t border-[var(--border-default)] pt-3">
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span>
                  <span className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">Manual payment</span>
                  <span className="block text-[10.5px] text-[var(--text-muted)] mt-0.5">For Cash, GCash, or bank transfer while PayMongo is pending. Runners register as pending until you mark payment received.</span>
                </span>
                <input disabled={(!!editingId && !can('payment.configure'))}
                  type="checkbox"
                  checked={manualPaymentEnabled}
                  onChange={(e) => {
                    setManualPaymentEnabled(e.target.checked);
                    if (e.target.checked) setOnlinePaymentEnabled(false);
                  }}
                  className="w-4 h-4 accent-red-600 shrink-0"
                />
              </label>
              {manualPaymentEnabled && (
                <div className="mt-3 space-y-3">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Instructions shown to runners</label>
                  <textarea disabled={(!!editingId && !can('payment.configure'))}
                    value={manualPaymentInstructions}
                    onChange={(e) => setManualPaymentInstructions(e.target.value)}
                    maxLength={500}
                    rows={3}
                    placeholder="EX: Pay via GCash to JUAN DELA CRUZ, 09XX XXX XXXX. Put your full name and race distance in the message. Cash payments accepted at the organizer's office."
                    className="w-full glass-inset px-3 py-2.5 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 resize-y"
                  />
                  <p className="text-[10px] text-amber-500 mt-1.5">Only add a payment destination you are authorized to publish. Confirm each payment in Assign Chips before releasing the race kit.</p>
                  <div className="border-t border-[var(--border-default)] pt-3">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">GCash / QRPh code <span className="normal-case font-normal text-[var(--text-muted)]">(optional)</span></label>
                    <p className="text-[10.5px] text-[var(--text-muted)] mb-2">Upload the organizer’s official payment QR. Runners can scan it directly during registration.</p>
                    <input disabled={(!!editingId && !can('payment.configure'))} ref={manualPaymentQrInputRef} type="file" accept="image/*" onChange={handleManualPaymentQrSelected} className="hidden" />
                    {manualPaymentQrImage ? (
                      <div className="relative w-44 max-w-full rounded-[16px] overflow-hidden border border-[var(--border-default)] bg-white p-2">
                        <img src={manualPaymentQrImage} alt="Manual payment QR code preview" className="w-full aspect-square object-contain" />
                        <button disabled={(!!editingId && !can('payment.configure'))} type="button" onClick={() => setManualPaymentQrImage('')} className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/70 hover:bg-black/90 text-white flex items-center justify-center transition" title="Remove payment QR"><X className="w-3.5 h-3.5" /></button>
                        <button disabled={(!!editingId && !can('payment.configure'))} type="button" onClick={() => manualPaymentQrInputRef.current?.click()} className="absolute bottom-2 right-2 text-[9px] font-black uppercase tracking-wide px-2.5 py-1.5 rounded-full bg-black/70 hover:bg-black/90 text-white flex items-center gap-1 transition"><ImagePlus className="w-3 h-3" /> Change</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => manualPaymentQrInputRef.current?.click()} disabled={(manualPaymentQrUploading) || (!!editingId && !can('payment.configure'))} className="w-full max-w-xs aspect-square rounded-[16px] border-2 border-dashed border-[var(--border-default)] flex flex-col items-center justify-center gap-2 text-[var(--text-secondary)] hover:text-amber-500 hover:border-amber-500/40 transition disabled:opacity-60">
                        {manualPaymentQrUploading ? <RefreshCw className="w-6 h-6 animate-spin" /> : <ImagePlus className="w-6 h-6" />}
                        <span className="text-xs font-bold uppercase tracking-wide">{manualPaymentQrUploading ? 'Processing...' : 'Upload GCash / QRPh Code'}</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Event Poster</label>
            <p className="text-[10.5px] text-[var(--text-secondary)] mb-2">Shown on the race card runners see when browsing events - a good poster gets more registrations.</p>
            <input disabled={(!!editingId && !can('race.artwork'))} ref={posterInputRef} type="file" accept="image/*" onChange={handlePosterSelected} className="hidden" />
            {posterImage ? (
              <div className="relative rounded-[16px] overflow-hidden border border-[var(--border-default)]">
                <img src={posterImage} alt="Race poster preview" className="w-full aspect-[16/9] object-cover" />
                <button disabled={(!!editingId && !can('race.artwork'))}
                  type="button"
                  onClick={() => setPosterImage('')}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition"
                  title="Remove poster"
                >
                  <X className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => posterInputRef.current?.click()}
                  className="absolute bottom-2 right-2 text-[10px] font-black uppercase tracking-wide px-3 py-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center gap-1.5 transition"
                >
                  <ImagePlus className="w-3 h-3" /> Change
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => posterInputRef.current?.click()}
                disabled={posterUploading}
                className="w-full aspect-[16/9] rounded-[16px] border-2 border-dashed border-[var(--border-default)] flex flex-col items-center justify-center gap-2 text-[var(--text-secondary)] hover:text-red-500 hover:border-red-500/40 transition disabled:opacity-60"
              >
                {posterUploading ? <RefreshCw className="w-6 h-6 animate-spin" /> : <ImagePlus className="w-6 h-6" />}
                <span className="text-xs font-bold uppercase tracking-wide">{posterUploading ? 'Processing...' : 'Upload Poster Image'}</span>
              </button>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Default Race Bib Template <span className="normal-case font-normal text-[var(--text-muted)]">(optional)</span></label>
            <p className="text-[10.5px] text-[var(--text-secondary)] mb-2">Upload a blank horizontal bib layout as the default/fallback. RacePulse automatically adds each runner’s name and bib number after registration.</p>
            <div className="mb-3 rounded-[14px] border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5 text-[10.5px] leading-relaxed text-[var(--text-secondary)]">
              <span className="font-black uppercase tracking-wide text-emerald-500">Print standard: </span>
              Design at <strong className="text-[var(--text-primary)]">1200 × 800 px</strong> (landscape, 3:2 ratio). The All Race Bibs PDF prints <strong className="text-[var(--text-primary)]">2 borderless bibs per A4 page</strong>, each one exact half-A4 (210 × 148.5 mm) for one straight centre cut. Keep important artwork at least 40 px from the edges; upload a blank template only—no runner name or bib number.
            </div>
            <input disabled={(!!editingId && !can('race.bibs'))} ref={raceBibInputRef} type="file" accept="image/*" onChange={handleRaceBibTemplateSelected} className="hidden" />
            {raceBibTemplateImage ? (
              <div className="space-y-3">
                <div className="relative rounded-[16px] overflow-hidden border border-[var(--border-default)] bg-[var(--surface-inset)]" style={{ containerType: 'inline-size' }}>
                  <img src={raceBibTemplateImage} alt="Race bib template preview" className="w-full aspect-[3/2] object-cover" />
                  <span className="absolute -translate-x-1/2 -translate-y-1/2 leading-none font-black tracking-tight drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)] whitespace-nowrap" style={{ left: `${bibNumberX}%`, top: `${bibNumberY}%`, fontSize: `${bibNumberSize}cqw`, color: bibNumberColor, fontFamily: raceBibFontFamily(bibNumberFont, raceBibCustomFont), WebkitTextStroke: `${bibNumberStrokeWidth}cqw ${bibNumberStrokeColor}`, paintOrder: 'stroke fill' }}>10-001</span>
                  <span className="absolute -translate-x-1/2 -translate-y-1/2 leading-none font-black tracking-wide drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)] whitespace-nowrap" style={{ left: `${runnerNameX}%`, top: `${runnerNameY}%`, fontSize: `${runnerNameSize}cqw`, color: runnerNameColor, fontFamily: raceBibFontFamily(runnerNameFont, raceBibCustomFont), WebkitTextStroke: `${runnerNameStrokeWidth}cqw ${runnerNameStrokeColor}`, paintOrder: 'stroke fill' }}>RUNNER NAME</span>
                  <button disabled={(!!editingId && !can('race.bibs'))} type="button" onClick={() => setRaceBibTemplateImage('')} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition" title="Remove race bib template"><X className="w-4 h-4" /></button>
                  <button disabled={(!!editingId && !can('race.bibs'))} type="button" onClick={() => raceBibInputRef.current?.click()} className="absolute bottom-2 right-2 text-[10px] font-black uppercase tracking-wide px-3 py-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center gap-1.5 transition"><ImagePlus className="w-3 h-3" /> Change</button>
                </div>
                <div className="glass-inset p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-2">Bib number position</p>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)]">X <input disabled={(!!editingId && !can('race.bibs'))} type="range" min="5" max="95" value={bibNumberX} onChange={(e) => setBibNumberX(Number(e.target.value))} className="flex-1 accent-red-600" /> {bibNumberX}%</label>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)] mt-1.5">Y <input disabled={(!!editingId && !can('race.bibs'))} type="range" min="5" max="95" value={bibNumberY} onChange={(e) => setBibNumberY(Number(e.target.value))} className="flex-1 accent-red-600" /> {bibNumberY}%</label>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)] mt-1.5">Size <input disabled={(!!editingId && !can('race.bibs'))} type="range" min="5" max="24" value={bibNumberSize} onChange={(e) => setBibNumberSize(Number(e.target.value))} className="flex-1 accent-red-600" /> {bibNumberSize}</label>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)] mt-1.5">Color <input disabled={(!!editingId && !can('race.bibs'))} type="color" value={bibNumberColor} onChange={(e) => setBibNumberColor(e.target.value)} className="w-7 h-6 p-0 border-0 rounded cursor-pointer bg-transparent" /> <span className="font-mono">{bibNumberColor}</span></label>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)] mt-1.5">Border <input disabled={(!!editingId && !can('race.bibs'))} type="color" value={bibNumberStrokeColor} onChange={(e) => setBibNumberStrokeColor(e.target.value)} className="w-7 h-6 p-0 border-0 rounded cursor-pointer bg-transparent" /> <span className="font-mono">{bibNumberStrokeColor}</span></label>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)] mt-1.5">Border thickness <input disabled={(!!editingId && !can('race.bibs'))} type="range" min="0" max="1.5" step="0.1" value={bibNumberStrokeWidth} onChange={(e) => setBibNumberStrokeWidth(Number(e.target.value))} className="flex-1 accent-red-600" /> {bibNumberStrokeWidth.toFixed(1)}</label>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)] mt-1.5">Font <select disabled={(!!editingId && !can('race.bibs'))} value={bibNumberFont} onChange={(e) => setBibNumberFont(e.target.value as RaceBibFont)} className="flex-1 glass-inset px-2 py-1 text-[10px] font-bold text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-red-500/50"><option value="mono">Timing Mono</option><option value="display">Racing Bold</option><option value="condensed">Condensed</option><option value="sans">Clean Sans</option><option value="custom" disabled={!raceBibCustomFont}>Uploaded Custom Font</option></select></label>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-2">Runner name position</p>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)]">X <input type="range" min="5" max="95" value={runnerNameX} onChange={(e) => setRunnerNameX(Number(e.target.value))} className="flex-1 accent-red-600" /> {runnerNameX}%</label>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)] mt-1.5">Y <input type="range" min="5" max="95" value={runnerNameY} onChange={(e) => setRunnerNameY(Number(e.target.value))} className="flex-1 accent-red-600" /> {runnerNameY}%</label>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)] mt-1.5">Size <input type="range" min="3" max="14" value={runnerNameSize} onChange={(e) => setRunnerNameSize(Number(e.target.value))} className="flex-1 accent-red-600" /> {runnerNameSize}</label>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)] mt-1.5">Color <input type="color" value={runnerNameColor} onChange={(e) => setRunnerNameColor(e.target.value)} className="w-7 h-6 p-0 border-0 rounded cursor-pointer bg-transparent" /> <span className="font-mono">{runnerNameColor}</span></label>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)] mt-1.5">Border <input type="color" value={runnerNameStrokeColor} onChange={(e) => setRunnerNameStrokeColor(e.target.value)} className="w-7 h-6 p-0 border-0 rounded cursor-pointer bg-transparent" /> <span className="font-mono">{runnerNameStrokeColor}</span></label>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)] mt-1.5">Border thickness <input type="range" min="0" max="1.5" step="0.1" value={runnerNameStrokeWidth} onChange={(e) => setRunnerNameStrokeWidth(Number(e.target.value))} className="flex-1 accent-red-600" /> {runnerNameStrokeWidth.toFixed(1)}</label>
                    <label className="flex items-center gap-2 text-[10px] font-bold text-[var(--text-secondary)] mt-1.5">Font <select disabled={(!!editingId && !can('race.bibs'))} value={runnerNameFont} onChange={(e) => setRunnerNameFont(e.target.value as RaceBibFont)} className="flex-1 glass-inset px-2 py-1 text-[10px] font-bold text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-red-500/50"><option value="display">Racing Bold</option><option value="sans">Clean Sans</option><option value="mono">Timing Mono</option><option value="condensed">Condensed</option><option value="custom" disabled={!raceBibCustomFont}>Uploaded Custom Font</option></select></label>
                  </div>
                </div>
                <div className="border-t border-[var(--border-default)] pt-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-1">Custom font <span className="normal-case font-normal text-[var(--text-muted)]">(optional)</span></p>
                  <p className="text-[10px] text-[var(--text-muted)] mb-2">Upload one WOFF2, WOFF, TTF, or OTF font (max 1.5 MB), then select “Uploaded Custom Font” above. WOFF2 is recommended.</p>
                  <input disabled={(!!editingId && !can('race.bibs'))} ref={raceBibFontInputRef} type="file" accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf" onChange={(e) => void handleRaceBibFontSelected(e)} className="hidden" />
                  {raceBibCustomFont ? (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-violet-500/25 bg-violet-500/5 px-3 py-2">
                      <span className="min-w-0 text-[10px] font-bold text-[var(--text-primary)] truncate">{raceBibCustomFont.name}</span>
                      <span className="flex shrink-0 gap-2"><button type="button" onClick={() => raceBibFontInputRef.current?.click()} disabled={(raceBibFontUploading) || (!!editingId && !can('race.bibs'))} className="text-[9px] font-black uppercase tracking-wide text-violet-500 hover:text-violet-400">Replace</button><button disabled={(!!editingId && !can('race.bibs'))} type="button" onClick={() => { setRaceBibCustomFont(undefined); if (bibNumberFont === 'custom') setBibNumberFont('mono'); if (runnerNameFont === 'custom') setRunnerNameFont('display'); }} className="text-[9px] font-black uppercase tracking-wide text-red-500 hover:text-red-400">Remove</button></span>
                    </div>
                  ) : (
                    <button type="button" onClick={() => raceBibFontInputRef.current?.click()} disabled={(raceBibFontUploading) || (!!editingId && !can('race.bibs'))} className="w-full rounded-xl border border-dashed border-violet-500/35 px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-violet-500 hover:bg-violet-500/5 transition disabled:opacity-60">{raceBibFontUploading ? 'Uploading font…' : 'Upload Custom Font'}</button>
                  )}
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => raceBibInputRef.current?.click()} disabled={(raceBibUploading) || (!!editingId && !can('race.bibs'))} className="w-full aspect-[3/2] rounded-[16px] border-2 border-dashed border-[var(--border-default)] flex flex-col items-center justify-center gap-2 text-[var(--text-secondary)] hover:text-red-500 hover:border-red-500/40 transition disabled:opacity-60">
                {raceBibUploading ? <RefreshCw className="w-6 h-6 animate-spin" /> : <ImagePlus className="w-6 h-6" />}
                <span className="text-xs font-bold uppercase tracking-wide">{raceBibUploading ? 'Processing...' : 'Upload Bib Layout — 1200 × 800 px'}</span>
              </button>
            )}
          </div>

          <div className="border-t border-[var(--border-default)] pt-5">
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Different Bib Design Per Distance <span className="normal-case font-normal text-[var(--text-muted)]">(optional)</span></label>
            <p className="text-[10.5px] text-[var(--text-secondary)] mb-3">Upload a separate blank design for 5K, 12K, 18K, and other distances. RacePulse automatically selects the correct design from the runner’s registered distance. The number/name placement above is shared by these designs.</p>
            {distances.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--border-default)] px-3 py-3 text-[10.5px] text-[var(--text-muted)]">Add your race distances first, then their individual bib upload boxes will appear here.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {[...distances].sort((a, b) => a.km - b.km).map((distance) => {
                  const label = `${distance.km}K`;
                  const template = raceBibTemplatesByDistance[label];
                  return (
                    <div key={distance.id} className="glass-inset p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-black text-[var(--text-primary)]">{label} bib design</p>
                        {template?.image && <span className="text-[9px] font-black uppercase tracking-wide text-emerald-500">Custom</span>}
                      </div>
                      <input disabled={(!!editingId && !can('race.bibs'))}
                        ref={(node) => { raceBibDistanceInputRefs.current[label] = node; }}
                        type="file"
                        accept="image/*"
                        onChange={(e) => void handleDistanceRaceBibTemplateSelected(label, e)}
                        className="hidden"
                      />
                      {template?.image ? (
                        <div className="relative overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)]">
                          <img src={template.image} alt={`${label} race bib template`} className="w-full aspect-[3/2] object-cover" />
                          <button disabled={(!!editingId && !can('race.bibs'))} type="button" onClick={() => setRaceBibTemplatesByDistance((current) => { const next = { ...current }; delete next[label]; return next; })} className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/70 hover:bg-black/90 text-white flex items-center justify-center transition" title={`Remove ${label} design`}><X className="w-3.5 h-3.5" /></button>
                          <button disabled={(!!editingId && !can('race.bibs'))} type="button" onClick={() => raceBibDistanceInputRefs.current[label]?.click()} className="absolute bottom-2 right-2 text-[9px] font-black uppercase tracking-wide px-2.5 py-1.5 rounded-full bg-black/70 hover:bg-black/90 text-white flex items-center gap-1 transition"><ImagePlus className="w-3 h-3" /> Change</button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => raceBibDistanceInputRefs.current[label]?.click()} disabled={(raceBibUploading) || (!!editingId && !can('race.bibs'))} className="w-full aspect-[3/2] rounded-xl border-2 border-dashed border-[var(--border-default)] flex flex-col items-center justify-center gap-1.5 text-[var(--text-secondary)] hover:text-red-500 hover:border-red-500/40 transition disabled:opacity-60">
                          {raceBibUploading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-5 h-5" />}
                          <span className="text-[10px] font-black uppercase tracking-wide">Upload {label} Design</span>
                          <span className="text-[9px] text-[var(--text-muted)]">Otherwise uses default bib</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Checkpoints (in order)</label>
            <p className="text-[10.5px] text-[var(--text-secondary)] mb-2">Check-In is optional and is never used for finish time. Add cutoffs to intermediate stations as minutes after the official gun start.</p>
            <div className="space-y-2">
              {checkpoints.map((cp, idx) => (
                <div key={cp.id} className="glass-inset p-2.5 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-mono text-[var(--text-muted)] w-5 shrink-0">{idx + 1}.</span>
                  <select disabled={(!!editingId && !can('race.categories'))}
                    value={cp.type}
                    onChange={(e) => updateCheckpoint(idx, { type: e.target.value as CheckpointType, cutoffMinutes: e.target.value === 'intermediate' ? cp.cutoffMinutes : '' })}
                    className="glass-inset px-2.5 py-2 text-[10px] font-bold uppercase tracking-wide text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                    aria-label="Checkpoint type"
                  >
                    <option value="checkin">Check-In</option>
                    <option value="start">Start</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="finish">Finish</option>
                  </select>
                  <input disabled={(!!editingId && !can('race.categories'))}
                    type="text"
                    required
                    value={cp.label}
                    onChange={(e) => updateCheckpoint(idx, { label: e.target.value })}
                    placeholder={cp.type === 'checkin' ? 'Check-In' : cp.type === 'start' ? 'Start' : cp.type === 'finish' ? 'Finish' : `Checkpoint ${idx}`}
                    className="min-w-[8rem] flex-1 glass-inset px-3 py-2 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                  />
                  {cp.type === 'intermediate' && (
                    <label className="flex items-center gap-1.5 text-[10px] font-bold text-[var(--text-secondary)] shrink-0">
                      Cutoff
                      <input disabled={(!!editingId && !can('race.categories'))}
                        type="number"
                        min={1}
                        step={1}
                        value={cp.cutoffMinutes}
                        onChange={(e) => updateCheckpoint(idx, { cutoffMinutes: e.target.value })}
                        placeholder="min"
                        className="w-16 glass-inset px-2 py-2 text-xs font-mono font-bold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                      />
                      min
                    </label>
                  )}
                  {(cp.type === 'checkin' || cp.type === 'intermediate') && (
                    <button disabled={(!!editingId && !can('race.categories'))} type="button" onClick={() => removeCheckpoint(idx)} className="text-[var(--text-muted)] hover:text-red-500 p-1.5" title="Remove checkpoint">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button disabled={(!!editingId && !can('race.categories'))} type="button" onClick={addCheckpoint} className="mt-2 text-xs font-bold text-red-500 hover:text-red-400 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Add Intermediate Checkpoint
            </button>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Distances (KM) &amp; Price</label>
            <div className="space-y-2">
              {distances.map((d, idx) => (
                <div key={d.id} className="flex items-center gap-2">
                  <input disabled={(!!editingId && !can('race.categories'))}
                    type="number"
                    required
                    min={1}
                    step="0.1"
                    value={d.km}
                    onChange={(e) => updateDistanceKm(idx, parseFloat(e.target.value) || 0)}
                    className="w-16 glass-inset px-2 py-2 text-xs font-semibold text-center text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                    title="Kilometers"
                  />
                  <span className="text-xs text-[var(--text-secondary)] w-10 shrink-0">{draftToDistance(d).label}</span>
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-red-500 pointer-events-none">₱</span>
                    <input disabled={(!!editingId && !can('race.categories'))}
                      type="number"
                      required
                      min={0}
                      step="0.01"
                      value={d.price === 0 ? '' : d.price}
                      onChange={(e) => updateDistancePrice(idx, parseFloat(e.target.value) || 0)}
                      placeholder="0"
                      className="w-full glass-inset pl-6 pr-2 py-2 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                      title="Registration price"
                    />
                  </div>
                  <button disabled={(!!editingId && !can('race.categories'))} type="button" onClick={() => removeDistance(idx)} className="text-[var(--text-muted)] hover:text-red-500 p-1.5">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {distances.length === 0 && (
                <p className="text-[10.5px] text-[var(--text-muted)]">No distances yet - add the kilometer options runners can register for (e.g. 5, 10, 21, 42), each with its own price.</p>
              )}
            </div>
            <button disabled={(!!editingId && !can('race.categories'))} type="button" onClick={addDistance} className="mt-2 text-xs font-bold text-red-500 hover:text-red-400 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Add Distance
            </button>
          </div>

          <div className="glass-inset p-3 space-y-2">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">Road Run Entry Categories</label>
              <p className="text-[10.5px] text-[var(--text-muted)] mt-0.5">Duo (2), Trio (3), and Group (4) share one race bib/chip and receive one team result.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(['solo', 'duo', 'trio', 'group'] as RaceEntryCategory[]).map((category) => (
                <label key={category} className={`cursor-pointer rounded-xl border px-2 py-2 text-center text-[10px] font-black uppercase tracking-wide transition ${entryCategories.includes(category) ? 'border-red-500/45 bg-red-500/10 text-red-500' : 'border-[var(--border-default)] text-[var(--text-secondary)]'}`}>
                  <input disabled={(!!editingId && !can('race.categories'))} type="checkbox" className="sr-only" checked={entryCategories.includes(category)} onChange={(event) => setEntryCategories((current) => event.target.checked ? [...current, category] : current.filter((item) => item !== category))} />
                  {entryCategoryLabels[category]}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Inclusions</label>
            <div className="space-y-2">
              {inclusions.map((incl, idx) => (
                <div key={incl.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    required
                    value={incl.text}
                    onChange={(e) => updateInclusionText(idx, e.target.value)}
                    placeholder="EX: Finisher Medal"
                    className="flex-1 glass-inset px-3 py-2 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                  />
                  <button type="button" onClick={() => removeInclusion(idx)} className="text-[var(--text-muted)] hover:text-red-500 p-1.5">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {inclusions.length === 0 && (
                <p className="text-[10.5px] text-[var(--text-muted)]">No inclusions yet - e.g. Finisher Medal, Race Singlet, Race Kit.</p>
              )}
            </div>
            <button type="button" onClick={addInclusion} className="mt-2 text-xs font-bold text-red-500 hover:text-red-400 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Add Inclusion
            </button>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Inclusion Design Preview <span className="normal-case font-normal text-[var(--text-muted)]">(optional)</span></label>
            <p className="text-[10.5px] text-[var(--text-secondary)] mb-2">Upload the shirt, medal, or race-kit design so runners can view it before registering.</p>
            <input disabled={(!!editingId && !can('race.artwork'))} ref={inclusionInputRef} type="file" accept="image/*" onChange={handleInclusionImageSelected} className="hidden" />
            {inclusionImage ? (
              <div className="relative rounded-[16px] overflow-hidden border border-[var(--border-default)] bg-[var(--surface-inset)]">
                <img src={inclusionImage} alt="Race inclusion preview" className="w-full aspect-square object-contain" />
                <button disabled={(!!editingId && !can('race.artwork'))}
                  type="button"
                  onClick={() => setInclusionImage('')}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition"
                  title="Remove inclusion image"
                >
                  <X className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => inclusionInputRef.current?.click()}
                  className="absolute bottom-2 right-2 text-[10px] font-black uppercase tracking-wide px-3 py-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center gap-1.5 transition"
                >
                  <ImagePlus className="w-3 h-3" /> Change
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => inclusionInputRef.current?.click()}
                disabled={inclusionUploading}
                className="w-full aspect-[16/9] rounded-[16px] border-2 border-dashed border-[var(--border-default)] flex flex-col items-center justify-center gap-2 text-[var(--text-secondary)] hover:text-red-500 hover:border-red-500/40 transition disabled:opacity-60"
              >
                {inclusionUploading ? <RefreshCw className="w-6 h-6 animate-spin" /> : <ImagePlus className="w-6 h-6" />}
                <span className="text-xs font-bold uppercase tracking-wide">{inclusionUploading ? 'Processing...' : 'Upload Shirt / Kit Design'}</span>
              </button>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Age Categories (Male / Female)</label>
            <div className="space-y-2">
              {ageCategories.map((cat, idx) => (
                <div key={cat.id} className="flex items-center gap-2">
                  <select disabled={(!!editingId && !can('race.categories'))}
                    value={cat.gender}
                    onChange={(e) => updateAgeCategory(idx, { gender: e.target.value as Gender })}
                    className="glass-inset px-2.5 py-2 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                  <input disabled={(!!editingId && !can('race.categories'))}
                    type="number"
                    required
                    min={1}
                    max={120}
                    value={cat.minAge}
                    onChange={(e) => updateAgeCategory(idx, { minAge: parseInt(e.target.value, 10) || 1 })}
                    className="w-16 glass-inset px-2 py-2 text-xs font-semibold text-center text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                  />
                  <span className="text-xs text-[var(--text-muted)]">to</span>
                  <input disabled={(!!editingId && !can('race.categories'))}
                    type="number"
                    required
                    min={1}
                    max={120}
                    value={cat.maxAge}
                    onChange={(e) => updateAgeCategory(idx, { maxAge: parseInt(e.target.value, 10) || 1 })}
                    className="w-16 glass-inset px-2 py-2 text-xs font-semibold text-center text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                  />
                  <input disabled={(!!editingId && !can('race.categories'))}
                    type="text"
                    value={cat.labelSuffix}
                    onChange={(e) => updateAgeCategory(idx, { labelSuffix: e.target.value })}
                    className="min-w-0 flex-1 glass-inset px-2 py-2 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
                    placeholder="Label, e.g. 20 & Below"
                    aria-label="Age category label"
                  />
                  <button disabled={(!!editingId && !can('race.categories'))} type="button" onClick={() => removeAgeCategory(idx)} className="text-[var(--text-muted)] hover:text-red-500 p-1.5">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {ageCategories.length === 0 && (
                <p className="text-[10.5px] text-[var(--text-muted)]">No age categories yet - runners will be reported as "Unclassified" until you add some.</p>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              <button disabled={(!!editingId && !can('race.categories'))} type="button" onClick={addAgeCategory} className="text-xs font-bold text-red-500 hover:text-red-400 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Add Age Category
              </button>
              <button disabled={(!!editingId && !can('race.categories'))} type="button" onClick={() => addAgeCategoryPreset(1, 20, '20 & Below')} className="text-xs font-bold text-red-500 hover:text-red-400">
                + Add 20 & Below (M/F)
              </button>
              <button disabled={(!!editingId && !can('race.categories'))} type="button" onClick={() => addAgeCategoryPreset(50, 120, '50 & Above')} className="text-xs font-bold text-red-500 hover:text-red-400">
                + Add 50 & Above (M/F)
              </button>
            </div>
          </div>

          {error && <p className="text-xs text-red-500 font-semibold">⚠️ {error}</p>}

          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="flex-1 text-xs font-black uppercase tracking-widest px-5 py-3 rounded-[var(--radius-control)] text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-lg shadow-red-900/30 flex items-center justify-center gap-2 transition disabled:opacity-60">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {editingId ? 'Save Changes' : 'Create Race'}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm} className="text-xs font-bold uppercase tracking-wider px-4 py-3 glass-inset text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-[var(--radius-control)] transition">
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="glass-panel p-5">
        <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] mb-3">{canSeeAllRaces ? 'All Races' : 'Your Races'}</h3>
        <div className="space-y-2">
          {races.length === 0 && <p className="text-xs text-[var(--text-secondary)]">No races yet - create one on the left.</p>}
          {races.map((race) => (
            <div key={race.id} className="glass-inset px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-[var(--text-primary)] truncate">{race.name}</p>
                <p className="text-[10px] text-[var(--text-secondary)]">
                  {race.date} &bull; {(race.distances || []).length} distances &bull; {race.checkpoints.length} checkpoints &bull; {(race.ageCategories || []).length} age categories
                </p>
                <p className="text-[10px] text-[var(--text-secondary)]">
                  {formatPriceRange(race.distances)} &bull; {(race.inclusions || []).length} inclusions
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5 shrink-0">
                {canSeeAllRaces && (
                  <button hidden={!can('bibs.export')}
                    type="button"
                    onClick={() => setBibDownloadRace(race)}
                    disabled={(!hasRaceBibTemplate(race) || raceBibPdfBusyRaceId === race.id) || (!!editingId && !can('race.bibs'))}
                    className="flex items-center gap-1 rounded-lg px-2 py-2 text-[10px] font-black uppercase tracking-wide text-[var(--text-secondary)] transition hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-35"
                    title={hasRaceBibTemplate(race) ? 'Download personalized race bibs by distance or for all runners — two bibs per A4 page' : 'Upload a race bib template first'}
                  >
                    {raceBibPdfBusyRaceId === race.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />} BIB PDF
                  </button>
                )}
                <button hidden={!can('roster.export')}
                  onClick={() => handleGenerateRunnerReport(race)}
                  disabled={reportBusyRaceId === race.id}
                  className="p-2 text-[var(--text-secondary)] hover:text-emerald-500 transition disabled:opacity-50"
                  title="Download runner roster and shirt-size inventory PDF"
                >
                  {reportBusyRaceId === race.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                </button>
                <button hidden={!can('race.registration')} onClick={() => setQrRace(race)} className="flex items-center gap-1 rounded-lg px-2 py-2 text-[10px] font-black uppercase tracking-wide text-[var(--text-secondary)] transition hover:text-violet-500" title="Show downloadable event registration QR code"><QrCode className="w-3.5 h-3.5" /> QR</button>
                <button hidden={!can('roster.slots')} onClick={() => setFreeSlotRace(race)} className="flex items-center gap-1 rounded-lg px-2 py-2 text-[10px] font-black uppercase tracking-wide text-[var(--text-secondary)] transition hover:text-cyan-500" title="Create anonymous late/on-site runner slots"><Plus className="w-3.5 h-3.5" /> Slots</button>
                <button hidden={!settingsAllowed} onClick={() => loadForEdit(race)} className="p-2 text-[var(--text-secondary)] hover:text-amber-500 transition" title="Edit race"><Pencil className="w-3.5 h-3.5" /></button>
                {canDeleteRaces && <button hidden={!authority} onClick={() => handleDelete(race.id)} className="p-2 text-[var(--text-secondary)] hover:text-red-500 transition" title="Delete race"><Trash2 className="w-3.5 h-3.5" /></button>}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] flex items-start gap-2 text-[10.5px] text-[var(--text-muted)]">
          <Users2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          The PDF starts with runner totals per distance and shirt size, then lists every runner by distance and age category.
        </div>
      </div>
      {qrRace && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="registration-qr-title" onClick={() => setQrRace(null)}>
          <div className="w-full max-w-sm rounded-[24px] border border-[var(--border-default)] bg-[var(--surface-page)] p-6 text-center shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 text-left">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-violet-500">Event registration QR</p>
                <h3 id="registration-qr-title" className="mt-1 text-base font-black uppercase tracking-tight text-[var(--text-primary)]">{qrRace.name}</h3>
                <p className="mt-1 text-[10.5px] text-[var(--text-secondary)]">Scan to open this event’s registration form.</p>
              </div>
              <button hidden={!can('race.registration')} type="button" onClick={() => setQrRace(null)} className="rounded-full p-1.5 text-[var(--text-muted)] transition hover:text-red-500" aria-label="Close registration QR"><X className="h-4 w-4" /></button>
            </div>
            <div className="mx-auto mt-5 inline-block rounded-[18px] bg-white p-4 shadow-lg">
              <QRCodeSVG ref={registrationQrRef} value={registrationUrl(qrRace.id)} size={224} level="M" includeMargin />
            </div>
            <p className="mt-3 break-all rounded-xl bg-[var(--surface-inset)] px-3 py-2 font-mono text-[9px] text-[var(--text-muted)]">{registrationUrl(qrRace.id)}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => void copyRegistrationUrl()} className="flex items-center justify-center gap-1.5 rounded-[14px] glass-inset px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-[var(--text-secondary)] transition hover:text-violet-500"><Copy className="h-3.5 w-3.5" /> Copy link</button>
              <button type="button" onClick={downloadRegistrationQr} className="flex items-center justify-center gap-1.5 rounded-[14px] bg-violet-600 px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-white transition hover:bg-violet-500"><Download className="h-3.5 w-3.5" /> Download QR</button>
            </div>
          </div>
        </div>
      )}
      {freeSlotRace && <FreeSlotsDialog race={freeSlotRace} onClose={() => setFreeSlotRace(null)} />}
      {bibDownloadRace && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="bib-download-title" onClick={() => !raceBibPdfBusyRaceId && setBibDownloadRace(null)}>
          <div className="w-full max-w-md rounded-[24px] border border-[var(--border-default)] bg-[var(--surface-page)] p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="bib-download-title" className="text-lg font-display font-black text-[var(--text-primary)]">Download Race Bibs</h3>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Choose all runners or one distance. Each PDF keeps two borderless bibs per A4 page. Group members receive separate same-number bibs; attach the single RFID chip to the captain’s bib only.</p>
              </div>
              <button hidden={!can('bibs.export')} type="button" onClick={() => setBibDownloadRace(null)} disabled={(Boolean(raceBibPdfBusyRaceId)) || (!!editingId && !can('race.bibs'))} className="rounded-lg p-2 text-[var(--text-secondary)] hover:text-red-500 disabled:opacity-40" aria-label="Close bib download options"><X className="w-5 h-5" /></button>
            </div>
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button hidden={!can('bibs.export')}
                type="button"
                onClick={() => void handleGenerateRaceBibs(bibDownloadRace)}
                disabled={(Boolean(raceBibPdfBusyRaceId)) || (!!editingId && !can('race.bibs'))}
                className="sm:col-span-2 rounded-xl bg-red-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-red-500 transition disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {raceBibPdfBusyRaceId ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} Download All Race Bibs
              </button>
              {(bibDownloadRace.distances || []).map((distance) => (
                <button hidden={!can('bibs.export')}
                  key={distance.id}
                  type="button"
                  onClick={() => void handleGenerateRaceBibs(bibDownloadRace, distance.label)}
                  disabled={(Boolean(raceBibPdfBusyRaceId)) || (!!editingId && !can('race.bibs'))}
                  className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-xs font-black uppercase tracking-widest text-violet-500 hover:bg-violet-500 hover:text-white transition disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {raceBibPdfBusyRaceId ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} {distance.label} Bibs
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface FreeSlotsDialogProps {
  race: Race;
  onClose: () => void;
}

function FreeSlotsDialog({ race, onClose }: FreeSlotsDialogProps) {
  const { can, authority } = useAccess();
  const [distanceLabel, setDistanceLabel] = useState(race.distances[0]?.label || '');
  const supportedCategories = raceEntryCategories(race);
  const [entryCategory, setEntryCategory] = useState<RaceEntryCategory>(supportedCategories[0] || 'solo');
  const [quantity, setQuantity] = useState(1);
  const [slots, setSlots] = useState<RunnerProfile[]>([]);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setDistanceLabel(race.distances[0]?.label || '');
    setEntryCategory(raceEntryCategories(race)[0] || 'solo');
    setQuantity(1);
    setMessage('');
    return onSnapshot(query(collection(db, 'runners'), where('raceId', '==', race.id)), (snapshot) => {
      const current: RunnerProfile[] = [];
      snapshot.forEach((runnerDoc) => {
        const runner = runnerDoc.data() as RunnerProfile;
        if (runner.isFreeSlot) current.push(runner);
      });
      current.sort((a, b) => a.distance.localeCompare(b.distance) || a.bibNumber.localeCompare(b.bibNumber, undefined, { numeric: true }));
      setSlots(current);
    }, (error) => setMessage(error.message || 'Could not load Free Slots.'));
  }, [race]);

  const createSlots = async () => {
    const distance = race.distances.find((item) => item.label === distanceLabel);
    const safeQuantity = Math.floor(Number(quantity));
    if (!distance) {
      setMessage('Choose a race distance first.');
      return;
    }
    if (!Number.isFinite(safeQuantity) || safeQuantity < 1 || safeQuantity > 100) {
      setMessage('Enter a quantity from 1 to 100.');
      return;
    }
    setCreating(true);
    setMessage('');
    try {
      const snapshot = await getDocs(query(collection(db, 'runners'), where('raceId', '==', race.id)));
      const usedBibs = new Set<string>();
      snapshot.forEach((runnerDoc) => usedBibs.add(normalizeBib(String(runnerDoc.data().bibNumber || ''))));
      const bibs = await reserveFreeSlotBibs(race, distance, entryCategory, safeQuantity, usedBibs);
      const now = new Date().toISOString();
      const batch = writeBatch(db);
      bibs.forEach((bib, index) => {
        const slotUid = `free_${race.id}_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`;
        const slot: RunnerProfile = {
          uid: slotUid,
          raceId: race.id,
          fullName: `FREE ${entryCategoryLabels[entryCategory].toUpperCase()} SLOT`,
          bibNumber: bib,
          distance: distance.label,
          entryCategory,
          gender: 'male',
          age: 18,
          ageNotProvided: true,
          isFreeSlot: true,
          createdAt: now,
        };
        batch.set(doc(db, 'runners', `${slotUid}_${race.id}`), slot);
      });
      await batch.commit();
      setMessage(`${bibs.length} ${entryCategoryLabels[entryCategory]} Free Slot${bibs.length === 1 ? '' : 's'} created for ${distance.label}: ${bibs[0]}${bibs.length > 1 ? ` to ${bibs[bibs.length - 1]}` : ''}.`);
    } catch (error: any) {
      console.warn('Failed to create Free Slots:', error);
      setMessage(error?.message || 'Could not create the Free Slots. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const slotsByDivision = race.distances.flatMap((distance) => supportedCategories.map((category) => ({
    distance,
    entryCategory: category,
    slots: slots.filter((slot) => slot.distance === distance.label && (slot.entryCategory || 'solo') === category),
  }))).filter((group) => group.slots.length > 0);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="free-slots-title" onClick={() => !creating && onClose()}>
      <div className="w-full max-w-lg rounded-[24px] border border-[var(--border-default)] bg-[var(--surface-page)] p-5 sm:p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-500">Race-day roster</p>
            <h3 id="free-slots-title" className="mt-1 text-lg font-display font-black text-[var(--text-primary)]">Free Slots</h3>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">Create empty Solo, Duo, Trio, or Group bib slots for late/on-site runners. They show as bib-only in timing and never join age categories.</p>
          </div>
          <button type="button" onClick={onClose} disabled={creating} className="rounded-lg p-2 text-[var(--text-secondary)] hover:text-red-500 disabled:opacity-40" aria-label="Close Free Slots"><X className="w-5 h-5" /></button>
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-[1fr_8rem_7rem] gap-2">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-[var(--text-secondary)]">Distance</span>
            <select value={distanceLabel} onChange={(event) => setDistanceLabel(event.target.value)} disabled={(creating) || (!can('roster.slots'))} className="w-full glass-inset px-3 py-3 text-sm font-bold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan-500/50 disabled:opacity-50">
              {race.distances.map((distance) => <option key={distance.id} value={distance.label}>{distance.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-[var(--text-secondary)]">Entry type</span>
            <select value={entryCategory} onChange={(event) => setEntryCategory(event.target.value as RaceEntryCategory)} disabled={(creating) || (!can('roster.slots'))} className="w-full glass-inset px-3 py-3 text-sm font-bold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan-500/50 disabled:opacity-50">
              {supportedCategories.map((category) => <option key={category} value={category}>{entryCategoryLabels[category]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-[var(--text-secondary)]">Slots</span>
            <input type="number" min="1" max="100" step="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} disabled={creating} className="w-full glass-inset px-3 py-3 text-sm font-bold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan-500/50 disabled:opacity-50" />
          </label>
        </div>
        <button type="button" onClick={() => void createSlots()} disabled={creating || race.distances.length === 0} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-55">
          {creating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {creating ? 'Creating slots…' : 'Create Free Slots'}
        </button>
        {message && <p className={`mt-3 rounded-xl px-3 py-2.5 text-xs font-semibold ${message.startsWith('Could') || message.startsWith('Choose') || message.startsWith('Enter') ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'}`}>{message}</p>}

        <div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Created Free Slots</h4>
            <span className="font-mono text-xs font-black text-cyan-500">{slots.length}</span>
          </div>
          {slots.length === 0 ? <p className="mt-3 text-xs text-[var(--text-muted)]">No empty slots yet.</p> : (
            <div className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1">
              {slotsByDivision.map(({ distance, entryCategory: category, slots: distanceSlots }) => (
                <div key={`${distance.id}_${category}`} className="rounded-xl glass-inset px-3 py-2.5">
                  <p className="text-[10px] font-black uppercase tracking-wide text-[var(--text-secondary)]">{distance.label} {entryCategoryLabels[category]} · {distanceSlots.length} slots</p>
                  <p className="mt-1 break-words font-mono text-xs font-bold text-[var(--text-primary)]">{distanceSlots.map((slot) => slot.bibNumber).join(' · ')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
