import React, { useEffect, useMemo, useRef, useState } from 'react';
import '../styles/highlights.css';
import {
  Award,
  CalendarDays,
  ChevronDown,
  Database,
  Eye,
  FileText,
  Flame,
  Globe,
  Layers,
  Palette,
  Plus,
  RotateCcw,
  Save,
  Search,
  Sliders,
  Sparkles,
  Trash2,
  Trophy,
  Upload,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useAccess } from '../lib/access';
import { subscribeSharedRaces } from '../lib/racesStore';
import { computeResults, getWaveStartTime } from '../lib/timing';
import {
  applyPlaylistRules,
  buildRunnerDirectory,
  capText,
  clampNumber,
  computeElapsedHmsFromClockPair,
  computeHighlightPace,
  DEFAULT_MARQUEE_CONFIG,
  deleteRunnerHighlight,
  deriveRaceCode,
  deriveRunnerAchievements,
  DirectoryRunner,
  entriesToParticipatedEvents,
  formatHighlightClockTime,
  getHighlightDisplayTitle,
  getRaceRankedEntries,
  HIGHLIGHT_BORDER_PRESETS,
  HIGHLIGHT_CAPS,
  HIGHLIGHT_CARD_EFFECTS,
  HIGHLIGHT_CORNER_GEOMETRIES,
  HIGHLIGHT_DISTANCES,
  HIGHLIGHT_HEADER_STYLES,
  HIGHLIGHT_PLACEMENTS,
  HIGHLIGHT_SURFACE_FINISHES,
  HighlightRunnerSortMode,
  HighlightRunnerSources,
  HighlightUserAccountPhoto,
  normalizeRunnerKey,
  parseDistanceKm,
  parseDurationToSeconds,
  RankedRaceRunnerItem,
  resolveRunnerAccountPhoto,
  RunnerRaceEntry,
  saveHighlightsMarqueeConfig,
  saveRunnerHighlight,
  subscribeHighlightRunnerSources,
  subscribeHighlightsConfig,
  subscribeRunnerHighlights,
  uploadHighlightAsset,
} from '../lib/highlights';
import {
  HighlightBorderPreset,
  HighlightCardLayoutMode,
  HighlightGroupMember,
  HighlightGroupPhotoLayout,
  HighlightsMarqueeConfig,
  Race,
  RunnerHighlight,
  RunnerResult,
  UserProfile,
} from '../types';
import DialogSurface from './ui/DialogSurface';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useFeedback } from './ui/FeedbackProvider';
import { isSafeRasterImageType } from '../lib/security';
import PodiumPulseCard from './PodiumPulseCard';
import PodiumPulseReel from './PodiumPulseReel';
import HighlightSmartCropModal from './HighlightSmartCropModal';
import FinisherDossierModal from './FinisherDossierModal';
import HighlightCustomSelect from './highlights/HighlightCustomSelect';
import CareerAchievementsEditor from './highlights/CareerAchievementsEditor';
import PublishedHighlightsManager from './highlights/PublishedHighlightsManager';
import MarqueeControlDeck from './highlights/MarqueeControlDeck';

type StudioSubTab = 'studio' | 'published' | 'deck';
type StudioComposerSection = 'athlete' | 'career' | 'style';

type PhotoSlotTarget =
  | { kind: 'primary' }
  | { kind: 'partner' }
  | { kind: 'group-member'; index: number };

interface HighlightsStudioPanelProps {
  profile: UserProfile;
  initialRaces?: Race[];
  initialRunnerSources?: HighlightRunnerSources;
}

const QUICK_ACCENT_SWATCHES = ['#ff3b30', '#f5b731', '#22d3ee', '#a855f7', '#10b981', '#ffffff'] as const;
const QUICK_BADGE_STAMPS = ['CHAMPION', 'NEW COURSE RECORD', 'SUB-1 HOUR', 'PODIUM FINISH'] as const;

function createBlankDraft(uid: string): RunnerHighlight {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  return {
    id: `hl_${Date.now().toString(36)}`,
    mode: 'solo',
    runnerName: '',
    bibNumber: '',
    partnerName: '',
    partnerBibNumber: '',
    photoUrl: '',
    partnerPhotoUrl: '',
    teamName: '',
    groupPhotoLayout: 'collage',
    groupMembers: [
      { name: '', bibNumber: '', photoUrl: '' },
      { name: '', bibNumber: '', photoUrl: '' },
    ],
    placement: '1st',
    distance: '10K',
    chipTime: '',
    gunTime: '',
    pace: '',
    splitPace: '',
    soloSplitTime: '',
    partnerSplitTime: '',
    combinedAvgPace: '',
    raceId: '',
    raceName: '',
    raceCode: '',
    raceDate: today,
    runClub: '',
    borderPreset: 'liquid-gold',
    cornerGeometry: 'rounded',
    accentColor: '#f5b731',
    secondaryAccentColor: '#ff3b30',
    glowIntensity: 75,
    surfaceFinish: 'glossy',
    cardEffect: 'sheen-sweep',
    headerStyle: 'crown-bezel',
    borderWidthPx: 3,
    scrimStrength: 78,
    badgeStamp: '',
    achievements: [],
    participatedEvents: [],
    pinned: false,
    expiresAt: '',
    createdBy: uid,
    createdAt: now,
    updatedAt: now,
  };
}

export default function HighlightsStudioPanel({
  profile,
  initialRaces,
  initialRunnerSources,
}: HighlightsStudioPanelProps) {
  const { can, authority: isSuperAdmin, state: accessState, inScope } = useAccess();
  const { confirm, notify } = useFeedback();

  const canManage = isSuperAdmin || can('highlights.manage');
  const canSettings = isSuperAdmin || can('highlights.settings');
  const canPlaylist = isSuperAdmin || can('highlights.playlist');
  const canViewRoster = isSuperAdmin || can('roster.view');
  const canViewTiming = isSuperAdmin || can('timing.view');
  const canViewUsers = isSuperAdmin || can('users.view');
  const allRacesScope = isSuperAdmin || !accessState.scope || accessState.scope === 'all';

  const [subTab, setSubTab] = useState<StudioSubTab>('studio');
  const [highlights, setHighlights] = useState<RunnerHighlight[]>([]);
  const [config, setConfig] = useState<HighlightsMarqueeConfig>(DEFAULT_MARQUEE_CONFIG);
  const [races, setRaces] = useState<Race[]>(() => initialRaces || []);
  const [runnerSources, setRunnerSources] = useState<HighlightRunnerSources>(
    () =>
      initialRunnerSources || {
        runners: [],
        liveResultsByRace: {},
        chipReads: [],
        userPhotosByUid: {},
      },
  );
  const [draft, setDraft] = useState<RunnerHighlight>(() => createBlankDraft(profile.uid));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingHighlight, setSavingHighlight] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // Required source race + rank-sorted directory combobox states
  const [runnerSortBy, setRunnerSortBy] = useState<HighlightRunnerSortMode>('rank');
  const [studioDistanceFilter, setStudioDistanceFilter] = useState<string>('all');
  const [selectedRunnerKey, setSelectedRunnerKey] = useState<string | null>(null);
  const [runnerDropdownOpen, setRunnerDropdownOpen] = useState(false);
  const [runnerActiveIndex, setRunnerActiveIndex] = useState(-1);
  const [partnerDropdownOpen, setPartnerDropdownOpen] = useState(false);
  const [partnerActiveIndex, setPartnerActiveIndex] = useState(-1);

  // Right preview toggles
  const [previewHover, setPreviewHover] = useState(false);
  const [previewLayout, setPreviewLayout] = useState<HighlightCardLayoutMode>('card');

  // Smart crop dialog & account photo picker state
  const [cropSession, setCropSession] = useState<{
    target: PhotoSlotTarget;
    sourceUrl: string;
  } | null>(null);
  const [accountPickerTarget, setAccountPickerTarget] = useState<PhotoSlotTarget | null>(null);
  const [accountSearch, setAccountSearch] = useState('');
  const accountSearchInputRef = useRef<HTMLInputElement | null>(null);

  // Studio composer section & dossier inspector
  const [composerSection, setComposerSection] = useState<StudioComposerSection>('athlete');
  const [dossierItem, setDossierItem] = useState<RunnerHighlight | null>(null);

  // Landing page live marquee preview state
  const [includeDraftInLandingPreview, setIncludeDraftInLandingPreview] = useState(true);
  const [landingPreviewSearch, setLandingPreviewSearch] = useState('');
  const [landingPreviewSearchFocused, setLandingPreviewSearchFocused] = useState(false);

  const primaryFileRef = useRef<HTMLInputElement | null>(null);
  const partnerFileRef = useRef<HTMLInputElement | null>(null);
  const groupMemberFileRef = useRef<HTMLInputElement | null>(null);
  const pendingGroupMemberIndexRef = useRef<number>(0);

  useEffect(() => {
    const unsubH = subscribeRunnerHighlights((items) => setHighlights(items));
    const unsubC = subscribeHighlightsConfig((cfg) => setConfig(cfg));
    const unsubR = subscribeSharedRaces((list, loaded) => {
      if (!loaded) return;
      if (!initialRaces?.length) {
        setRaces(list);
        return;
      }
      const seen = new Set(list.map((r) => r.id));
      setRaces([...list, ...initialRaces.filter((r) => !seen.has(r.id))]);
    });
    return () => {
      unsubH();
      unsubC();
      unsubR();
    };
  }, [initialRaces]);

  const scopedRaceIdsKey = useMemo(() => {
    if (allRacesScope) return '';
    return races
      .filter(inScope)
      .map((r) => r.id)
      .sort()
      .join(',');
  }, [allRacesScope, races, inScope]);

  useEffect(() => {
    const scopedRaceIds = scopedRaceIdsKey ? scopedRaceIdsKey.split(',') : [];
    return subscribeHighlightRunnerSources(
      {
        canViewRoster,
        canViewTiming,
        canViewUsers,
        allRacesScope,
        scopedRaceIds,
      },
      (incoming) => {
        if (!initialRunnerSources) {
          setRunnerSources(incoming);
          return;
        }
        setRunnerSources({
          runners: incoming.runners.length > 0 ? incoming.runners : initialRunnerSources.runners,
          liveResultsByRace: {
            ...initialRunnerSources.liveResultsByRace,
            ...incoming.liveResultsByRace,
          },
          chipReads: incoming.chipReads.length > 0 ? incoming.chipReads : initialRunnerSources.chipReads,
          userPhotosByUid: {
            ...initialRunnerSources.userPhotosByUid,
            ...incoming.userPhotosByUid,
          },
          userAccounts: incoming.userAccounts?.length
            ? incoming.userAccounts
            : initialRunnerSources.userAccounts,
        });
      },
    );
  }, [canViewRoster, canViewTiming, canViewUsers, allRacesScope, scopedRaceIdsKey, initialRunnerSources]);

  const computedResultsByRace = useMemo<Record<string, RunnerResult[]>>(() => {
    if (runnerSources.chipReads.length === 0 || races.length === 0) return {};
    const readsByRace = new Map<string, typeof runnerSources.chipReads>();
    for (const read of runnerSources.chipReads) {
      const list = readsByRace.get(read.raceId) || [];
      list.push(read);
      readsByRace.set(read.raceId, list);
    }
    const runnersByRace = new Map<string, typeof runnerSources.runners>();
    for (const reg of runnerSources.runners) {
      const list = runnersByRace.get(reg.raceId) || [];
      list.push(reg);
      runnersByRace.set(reg.raceId, list);
    }
    const out: Record<string, RunnerResult[]> = {};
    for (const race of races) {
      const reads = readsByRace.get(race.id);
      if (!reads || reads.length === 0) continue;
      out[race.id] = computeResults(
        race.checkpoints,
        reads,
        runnersByRace.get(race.id) || [],
        race.ageCategories,
        race,
      );
    }
    return out;
  }, [runnerSources.chipReads, runnerSources.runners, races]);

  const availableAccounts = useMemo<HighlightUserAccountPhoto[]>(() => {
    const byUid = new Map<string, HighlightUserAccountPhoto>();
    for (const acc of runnerSources.userAccounts || []) {
      if (acc.photoURL) byUid.set(acc.uid, acc);
    }
    for (const reg of runnerSources.runners) {
      if (!reg.uid) continue;
      const url = runnerSources.userPhotosByUid[reg.uid];
      if (url && !byUid.has(reg.uid)) {
        byUid.set(reg.uid, {
          uid: reg.uid,
          displayName: reg.fullName || 'Runner',
          photoURL: url,
        });
      }
    }
    for (const [uid, url] of Object.entries(runnerSources.userPhotosByUid || {})) {
      if (url && !byUid.has(uid)) {
        byUid.set(uid, { uid, displayName: `Account ${uid.slice(0, 8)}`, photoURL: url });
      }
    }
    return Array.from(byUid.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [runnerSources.userAccounts, runnerSources.runners, runnerSources.userPhotosByUid]);

  const filteredAccountChoices = useMemo(() => {
    const q = accountSearch.trim().toLowerCase();
    if (!q) return availableAccounts;
    return availableAccounts.filter(
      (acc) =>
        acc.displayName.toLowerCase().includes(q) ||
        (acc.nickname || '').toLowerCase().includes(q) ||
        (acc.username || '').toLowerCase().includes(q) ||
        acc.uid.toLowerCase().includes(q),
    );
  }, [availableAccounts, accountSearch]);

  const runnerDirectory = useMemo(
    () =>
      buildRunnerDirectory({
        runners: runnerSources.runners,
        races,
        liveResultsByRace: runnerSources.liveResultsByRace,
        computedResultsByRace,
        userPhotosByUid: runnerSources.userPhotosByUid,
        userAccounts: availableAccounts,
      }),
    [
      runnerSources.runners,
      races,
      runnerSources.liveResultsByRace,
      computedResultsByRace,
      runnerSources.userPhotosByUid,
      availableAccounts,
    ],
  );

  const activeRunner = useMemo<DirectoryRunner | null>(() => {
    if (selectedRunnerKey) {
      const byKey = runnerDirectory.find((r) => r.key === selectedRunnerKey);
      if (byKey) return byKey;
    }
    const typedKey = normalizeRunnerKey(draft.runnerName);
    if (!typedKey) return null;
    return runnerDirectory.find((r) => r.key === typedKey) || null;
  }, [runnerDirectory, selectedRunnerKey, draft.runnerName]);

  const matchedActiveEntry = useMemo<RunnerRaceEntry | null>(() => {
    if (!activeRunner || !draft.raceId) return null;
    const exactBib = activeRunner.entries.find(
      (e) => e.raceId === draft.raceId && e.bibNumber.toUpperCase() === draft.bibNumber.trim().toUpperCase(),
    );
    if (exactBib) return exactBib;
    return activeRunner.entries.find((e) => e.raceId === draft.raceId) || null;
  }, [activeRunner, draft.raceId, draft.bibNumber]);

  const selectedRace = useMemo(
    () => (draft.raceId ? races.find((r) => r.id === draft.raceId) || null : null),
    [races, draft.raceId],
  );

  const availableDistances = useMemo(() => {
    const list: string[] = [];
    const pushUnique = (val: string | undefined) => {
      const trimmed = (val || '').trim();
      if (!trimmed) return;
      if (!list.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
        list.push(trimmed);
      }
    };
    if (selectedRace) {
      for (const d of selectedRace.distances || []) {
        pushUnique(d.label);
      }
      if (activeRunner) {
        for (const e of activeRunner.entries) {
          if (e.raceId === selectedRace.id) pushUnique(e.distance);
        }
      }
      if (draft.distance) pushUnique(draft.distance);
      if (list.length === 0) {
        for (const d of HIGHLIGHT_DISTANCES) pushUnique(d);
      }
      return list;
    }
    for (const d of HIGHLIGHT_DISTANCES) pushUnique(d);
    return list;
  }, [selectedRace, activeRunner, draft.distance]);

  const availablePlacements = useMemo(() => {
    const list: string[] = [...HIGHLIGHT_PLACEMENTS];
    const fromEntry = matchedActiveEntry?.placement?.trim();
    if (fromEntry && !list.some((p) => p.toLowerCase() === fromEntry.toLowerCase())) {
      list.unshift(fromEntry);
    }
    return list;
  }, [matchedActiveEntry?.placement]);

  const matchedDistanceOption = useMemo(() => {
    const current = (draft.distance || '').trim();
    if (!current) return selectedRace ? availableDistances[0] || '' : 'custom';
    const found = availableDistances.find((d) => d.toLowerCase() === current.toLowerCase());
    if (found) return found;
    return selectedRace ? availableDistances[0] || current : 'custom';
  }, [availableDistances, draft.distance, selectedRace]);

  const matchedPlacementOption = useMemo(() => {
    const current = (draft.placement || '').trim();
    if (!current) return 'custom';
    const found = availablePlacements.find((p) => p.toLowerCase() === current.toLowerCase());
    return found || 'custom';
  }, [availablePlacements, draft.placement]);

  useEffect(() => {
    if (draft.raceId || editingId || races.length === 0) return;
    const raceWithRunners = races.find((r) =>
      runnerDirectory.some((runner) => runner.entries.some((e) => e.raceId === r.id)),
    );
    const defaultRace = raceWithRunners || races[0];
    if (!defaultRace) return;
    const nextDistance = capText(defaultRace.distances?.[0]?.label || '10K', HIGHLIGHT_CAPS.distance);
    const waveStart = formatHighlightClockTime(
      getWaveStartTime(defaultRace, nextDistance, draft.mode === 'duo' ? 'duo' : undefined),
    );
    setDraft((prev) => {
      if (prev.raceId) return prev;
      return {
        ...prev,
        raceId: defaultRace.id,
        raceName: defaultRace.name.slice(0, HIGHLIGHT_CAPS.raceName),
        raceDate: defaultRace.date,
        raceCode: deriveRaceCode(defaultRace.name, defaultRace.date),
        distance: nextDistance,
        gunTime: prev.gunTime || waveStart || '',
      };
    });
  }, [races, runnerDirectory, draft.raceId, editingId, draft.mode]);

  const raceRunnerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const runner of runnerDirectory) {
      const seen = new Set<string>();
      for (const entry of runner.entries) {
        if (entry.raceId && !seen.has(entry.raceId)) {
          seen.add(entry.raceId);
          counts[entry.raceId] = (counts[entry.raceId] || 0) + 1;
        }
      }
    }
    return counts;
  }, [runnerDirectory]);

  const activeRaceIdForQuery = draft.raceId || races[0]?.id || '';

  const raceFilterDistances = useMemo(() => {
    const targetRace = races.find((r) => r.id === activeRaceIdForQuery) || selectedRace;
    const list: string[] = [];
    for (const d of targetRace?.distances || []) {
      const trimmed = (d.label || '').trim();
      if (trimmed && !list.some((x) => x.toLowerCase() === trimmed.toLowerCase())) {
        list.push(trimmed);
      }
    }
    if (activeRaceIdForQuery) {
      for (const runner of runnerDirectory) {
        for (const entry of runner.entries) {
          if (entry.raceId !== activeRaceIdForQuery) continue;
          const dist = (entry.distance || '').trim();
          if (dist && !list.some((x) => x.toLowerCase() === dist.toLowerCase())) {
            list.push(dist);
          }
        }
      }
    }
    return list;
  }, [races, activeRaceIdForQuery, selectedRace, runnerDirectory]);

  const rankedRaceEntries = useMemo<RankedRaceRunnerItem[]>(() => {
    if (!activeRaceIdForQuery) return [];
    return getRaceRankedEntries({
      runnerDirectory,
      raceId: activeRaceIdForQuery,
      distanceFilter: studioDistanceFilter,
      sortBy: runnerSortBy,
      searchQuery: selectedRunnerKey ? '' : draft.runnerName,
    });
  }, [
    runnerDirectory,
    activeRaceIdForQuery,
    studioDistanceFilter,
    runnerSortBy,
    selectedRunnerKey,
    draft.runnerName,
  ]);

  const filteredRunnerSuggestions = useMemo<RankedRaceRunnerItem[]>(() => {
    if (activeRaceIdForQuery) {
      return rankedRaceEntries.slice(0, 40);
    }
    const q = normalizeRunnerKey(draft.runnerName);
    const items: RankedRaceRunnerItem[] = [];
    for (const runner of runnerDirectory) {
      const entry = runner.entries[0];
      if (!entry) continue;
      if (
        !q ||
        runner.key.includes(q) ||
        entry.bibNumber.toLowerCase().includes(q) ||
        entry.raceName.toLowerCase().includes(q)
      ) {
        items.push({ runner, entry });
      }
    }
    return items.slice(0, 40);
  }, [activeRaceIdForQuery, rankedRaceEntries, runnerDirectory, draft.runnerName]);

  const podiumQuickPicks = useMemo<RankedRaceRunnerItem[]>(() => {
    if (!activeRaceIdForQuery) return [];
    const byRank = getRaceRankedEntries({
      runnerDirectory,
      raceId: activeRaceIdForQuery,
      distanceFilter: studioDistanceFilter,
      sortBy: 'rank',
    });
    const ranked = byRank.filter((item) => item.entry.rank != null);
    return (ranked.length > 0 ? ranked : byRank).slice(0, 6);
  }, [runnerDirectory, activeRaceIdForQuery, studioDistanceFilter]);

  const filteredPartnerSuggestions = useMemo(() => {
    const q = normalizeRunnerKey(draft.partnerName);
    const candidates = runnerDirectory.filter((r) => r.key !== activeRunner?.key);
    const prioritized = draft.raceId
      ? [...candidates].sort((a, b) => {
          const aInRace = a.entries.some((e) => e.raceId === draft.raceId) ? 0 : 1;
          const bInRace = b.entries.some((e) => e.raceId === draft.raceId) ? 0 : 1;
          return aInRace - bInRace || a.fullName.localeCompare(b.fullName);
        })
      : candidates;
    if (!q) return prioritized.slice(0, 12);
    return prioritized
      .filter(
        (r) =>
          r.key.includes(q) ||
          r.entries.some((e) => e.bibNumber.toLowerCase().includes(q) || e.raceName.toLowerCase().includes(q)),
      )
      .slice(0, 25);
  }, [runnerDirectory, draft.partnerName, draft.raceId, activeRunner?.key]);

  const orderedHighlights = useMemo(
    () => applyPlaylistRules(highlights, { ...config, hideExpired: false, filterRaceId: '' }),
    [highlights, config],
  );

  const matchedPrimaryAccount = useMemo(
    () =>
      resolveRunnerAccountPhoto({
        uid: matchedActiveEntry?.uid || activeRunner?.uid,
        fullName: draft.runnerName,
        userPhotosByUid: runnerSources.userPhotosByUid,
        userAccounts: availableAccounts,
      }),
    [matchedActiveEntry?.uid, activeRunner?.uid, draft.runnerName, runnerSources.userPhotosByUid, availableAccounts],
  );

  const matchedPartnerAccount = useMemo(() => {
    const partnerRunner = draft.partnerName
      ? runnerDirectory.find((r) => r.key === normalizeRunnerKey(draft.partnerName))
      : undefined;
    return resolveRunnerAccountPhoto({
      uid: partnerRunner?.uid,
      fullName: draft.partnerName,
      userPhotosByUid: runnerSources.userPhotosByUid,
      userAccounts: availableAccounts,
    });
  }, [draft.partnerName, runnerDirectory, runnerSources.userPhotosByUid, availableAccounts]);

  const livePreviewItem = useMemo<RunnerHighlight>(() => {
    const previewMembers =
      draft.mode === 'group'
        ? (draft.groupMembers || [])
            .map((m, idx) => ({
              ...m,
              name: m.name || `Member ${idx + 1}`,
            }))
            .slice(0, 6)
        : undefined;
    return {
      ...draft,
      runnerName:
        draft.runnerName ||
        (draft.mode === 'group' ? draft.teamName || previewMembers?.[0]?.name || 'Squad Highlight' : 'Runner Name'),
      bibNumber:
        draft.bibNumber ||
        (draft.mode === 'group' ? previewMembers?.find((m) => m.bibNumber)?.bibNumber || '1042' : '1042'),
      partnerName: draft.mode === 'duo' ? draft.partnerName || 'Partner Name' : undefined,
      partnerBibNumber: draft.mode === 'duo' ? draft.partnerBibNumber || '1043' : undefined,
      groupMembers: previewMembers,
      chipTime: draft.chipTime || '00:41:18',
      pace: draft.pace || '4:08 /km',
      raceName: draft.raceName || 'RacePulsePH Classic',
      raceDate: draft.raceDate || new Date().toISOString().slice(0, 10),
    };
  }, [draft]);

  const landingPreviewHighlights = useMemo<RunnerHighlight[]>(() => {
    if (!includeDraftInLandingPreview) {
      return highlights;
    }
    if (editingId) {
      const exists = highlights.some((item) => item.id === editingId);
      if (exists) {
        return highlights.map((item) => (item.id === editingId ? livePreviewItem : item));
      }
    }
    return [livePreviewItem, ...highlights.filter((item) => item.id !== livePreviewItem.id)];
  }, [highlights, includeDraftInLandingPreview, editingId, livePreviewItem]);

  const handleSelectFile = (target: PhotoSlotTarget, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!isSafeRasterImageType(file.type, file.name)) {
      notify({ title: 'Unsupported file', message: 'Select a JPG, PNG, WebP, GIF, or AVIF photo.', tone: 'error' });
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      notify({ title: 'Photo too large', message: 'Select a photo smaller than 15 MB.', tone: 'error' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCropSession({ target, sourceUrl: reader.result });
      }
    };
    reader.readAsDataURL(file);
  };

  const applyPhotoToSlot = (target: PhotoSlotTarget, url: string, account?: HighlightUserAccountPhoto) => {
    setDraft((prev) => {
      if (target.kind === 'primary') {
        return {
          ...prev,
          photoUrl: url,
          runnerName: !prev.runnerName.trim() && account ? account.displayName.slice(0, HIGHLIGHT_CAPS.runnerName) : prev.runnerName,
        };
      }
      if (target.kind === 'partner') {
        return {
          ...prev,
          partnerPhotoUrl: url,
          partnerName: !prev.partnerName?.trim() && account ? account.displayName.slice(0, HIGHLIGHT_CAPS.runnerName) : prev.partnerName,
        };
      }
      const nextMembers = [...(prev.groupMembers || [])];
      const existing = nextMembers[target.index] || { name: '' };
      nextMembers[target.index] = {
        ...existing,
        photoUrl: url,
        name: !existing.name.trim() && account ? account.displayName.slice(0, HIGHLIGHT_CAPS.runnerName) : existing.name,
        uid: account?.uid || existing.uid,
      };
      return {
        ...prev,
        groupMembers: nextMembers,
      };
    });
  };

  const handleOpenAccountPicker = (target: PhotoSlotTarget) => {
    setAccountSearch('');
    setAccountPickerTarget(target);
  };

  const handleSwitchHighlightMode = (nextMode: 'solo' | 'duo' | 'group') => {
    setDraft((prev) => {
      if (nextMode !== 'group') {
        return { ...prev, mode: nextMode };
      }
      const existingMembers = prev.groupMembers || [];
      const hasAnyPopulated = existingMembers.some((m) => m.name.trim() || m.bibNumber?.trim() || m.photoUrl?.trim());
      if (hasAnyPopulated) {
        return {
          ...prev,
          mode: 'group',
          groupPhotoLayout: prev.groupPhotoLayout || 'collage',
        };
      }
      const seeded: HighlightGroupMember[] = [];
      if (prev.runnerName.trim() || prev.bibNumber.trim() || prev.photoUrl.trim()) {
        seeded.push({
          name: prev.runnerName,
          bibNumber: prev.bibNumber,
          photoUrl: prev.photoUrl,
        });
      }
      if (prev.partnerName?.trim() || prev.partnerBibNumber?.trim() || prev.partnerPhotoUrl?.trim()) {
        seeded.push({
          name: prev.partnerName || '',
          bibNumber: prev.partnerBibNumber || '',
          photoUrl: prev.partnerPhotoUrl || '',
        });
      }
      while (seeded.length < 2) {
        seeded.push({ name: '', bibNumber: '', photoUrl: '' });
      }
      return {
        ...prev,
        mode: 'group',
        groupPhotoLayout: prev.groupPhotoLayout || 'collage',
        groupMembers: seeded,
      };
    });
  };

  const handleAddGroupMember = () => {
    setDraft((prev) => {
      const current = prev.groupMembers || [];
      if (current.length >= 6) return prev;
      return {
        ...prev,
        groupMembers: [...current, { name: '', bibNumber: '', photoUrl: '' }],
      };
    });
  };

  const handleUpdateGroupMember = (index: number, patch: Partial<HighlightGroupMember>) => {
    setDraft((prev) => {
      const next = [...(prev.groupMembers || [])];
      const current = next[index] || { name: '' };
      next[index] = { ...current, ...patch };
      return { ...prev, groupMembers: next };
    });
  };

  const handleRemoveGroupMember = (index: number) => {
    setDraft((prev) => {
      const current = prev.groupMembers || [];
      if (current.length <= 1) return prev;
      return {
        ...prev,
        groupMembers: current.filter((_, i) => i !== index),
      };
    });
  };

  const applyRunnerRaceEntry = (entry: RunnerRaceEntry, runner: DirectoryRunner) => {
    setSelectedRunnerKey(runner.key);
    setDraft((prev) => {
      const useDuo = entry.entryCategory === 'duo' && Boolean(entry.partnerName);
      const useGroup = entry.entryCategory === 'trio' || entry.entryCategory === 'group';
      const primaryAccountUrl = entry.photoUrl || runner.photoUrl || '';
      const groupMembersFromEntry: HighlightGroupMember[] = useGroup
        ? entry.teamMembers && entry.teamMembers.length > 0
          ? entry.teamMembers.slice(0, 6)
          : [{ name: runner.fullName, bibNumber: entry.bibNumber, photoUrl: primaryAccountUrl || undefined, uid: entry.uid || runner.uid }]
        : prev.groupMembers || [];
      const firstGroupPhoto = groupMembersFromEntry.find((m) => m.photoUrl)?.photoUrl || primaryAccountUrl;

      const participatedEvents = entriesToParticipatedEvents(runner.entries);
      const achievements = deriveRunnerAchievements(
        runner.entries,
        entry.placement,
        prev.badgeStamp,
      );

      return {
        ...prev,
        runnerName: runner.fullName.slice(0, HIGHLIGHT_CAPS.runnerName),
        bibNumber: entry.bibNumber.slice(0, HIGHLIGHT_CAPS.bibNumber),
        placement: entry.placement,
        distance: entry.distance,
        chipTime: entry.chipTime,
        gunTime: entry.gunTime,
        pace: entry.pace,
        splitPace: entry.splitPace,
        raceId: entry.raceId,
        raceName: entry.raceName.slice(0, HIGHLIGHT_CAPS.raceName),
        raceDate: entry.raceDate,
        raceCode: entry.raceCode,
        photoUrl: !prev.photoUrl && (firstGroupPhoto || primaryAccountUrl) ? firstGroupPhoto || primaryAccountUrl : prev.photoUrl,
        participatedEvents,
        achievements,
        ...(useDuo
          ? {
              mode: 'duo' as const,
              partnerName: (entry.partnerName || '').slice(0, HIGHLIGHT_CAPS.runnerName),
              partnerBibNumber: (entry.partnerBibNumber || '').slice(0, HIGHLIGHT_CAPS.bibNumber),
              partnerPhotoUrl:
                !prev.partnerPhotoUrl && entry.partnerPhotoUrl ? entry.partnerPhotoUrl : prev.partnerPhotoUrl,
              soloSplitTime: entry.chipTime || prev.soloSplitTime,
              partnerSplitTime: entry.partnerSplitTime || prev.partnerSplitTime,
              combinedAvgPace: entry.combinedAvgPace || entry.pace || prev.combinedAvgPace,
            }
          : useGroup
            ? {
                mode: 'group' as const,
                teamName: (entry.teamName || prev.teamName || '').slice(0, HIGHLIGHT_CAPS.teamName),
                groupPhotoLayout: prev.groupPhotoLayout || ('collage' as HighlightGroupPhotoLayout),
                groupMembers: groupMembersFromEntry,
              }
            : prev.mode === 'duo'
              ? {
                  soloSplitTime: entry.chipTime || '',
                }
              : {}),
      };
    });
  };

  const handleSelectRankedEntry = (item: RankedRaceRunnerItem) => {
    setRunnerDropdownOpen(false);
    setRunnerActiveIndex(-1);
    applyRunnerRaceEntry(item.entry, item.runner);
  };

  const handleSelectPartnerFromDirectory = (partner: DirectoryRunner) => {
    setPartnerDropdownOpen(false);
    setPartnerActiveIndex(-1);
    const entry = (draft.raceId ? partner.entries.find((e) => e.raceId === draft.raceId) : undefined) || partner.entries[0];
    setDraft((prev) => {
      if (!entry) {
        return {
          ...prev,
          partnerName: partner.fullName.slice(0, HIGHLIGHT_CAPS.runnerName),
          partnerPhotoUrl:
            !prev.partnerPhotoUrl && partner.photoUrl ? partner.photoUrl : prev.partnerPhotoUrl,
        };
      }
      const soloSecs = parseDurationToSeconds(prev.soloSplitTime || prev.chipTime);
      const partSecs = parseDurationToSeconds(entry.chipTime);
      let combinedAvgPace = prev.combinedAvgPace || entry.pace;
      if (soloSecs > 0 && partSecs > 0 && entry.distanceKm > 0) {
        const avgTotal = Math.round((soloSecs + partSecs) / 2);
        const h = Math.floor(avgTotal / 3600);
        const m = Math.floor((avgTotal % 3600) / 60);
        const s = avgTotal % 60;
        const avgStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        combinedAvgPace = computeHighlightPace(avgStr, entry.distanceKm) || combinedAvgPace;
      }
      return {
        ...prev,
        partnerName: partner.fullName.slice(0, HIGHLIGHT_CAPS.runnerName),
        partnerBibNumber: entry.bibNumber.slice(0, HIGHLIGHT_CAPS.bibNumber),
        partnerSplitTime: entry.chipTime || prev.partnerSplitTime,
        combinedAvgPace,
        partnerPhotoUrl:
          !prev.partnerPhotoUrl && (entry.photoUrl || partner.photoUrl)
            ? entry.photoUrl || partner.photoUrl || ''
            : prev.partnerPhotoUrl,
      };
    });
  };

  const handleLinkedRaceChange = (selectedVal: string) => {
    if (!selectedVal) {
      setDraft((prev) => ({ ...prev, raceId: '' }));
      return;
    }
    if (selectedVal.startsWith('entry::') && activeRunner) {
      const rest = selectedVal.slice('entry::'.length);
      const sepIdx = rest.indexOf('::');
      const rId = sepIdx >= 0 ? rest.slice(0, sepIdx) : rest;
      const bib = sepIdx >= 0 ? rest.slice(sepIdx + 2) : '';
      const entry =
        activeRunner.entries.find((e) => e.raceId === rId && e.bibNumber === bib) ||
        activeRunner.entries.find((e) => e.raceId === rId);
      if (entry) {
        setStudioDistanceFilter('all');
        applyRunnerRaceEntry(entry, activeRunner);
        return;
      }
    }
    const rId = selectedVal.startsWith('race::') ? selectedVal.slice('race::'.length) : selectedVal;
    setStudioDistanceFilter('all');
    if (activeRunner) {
      const matchingEntry = activeRunner.entries.find((e) => e.raceId === rId);
      if (matchingEntry) {
        applyRunnerRaceEntry(matchingEntry, activeRunner);
        return;
      }
    }
    const found = races.find((r) => r.id === rId);
    if (!found) return;
    const hadDirectoryRunner = Boolean(selectedRunnerKey);
    if (hadDirectoryRunner) {
      setSelectedRunnerKey(null);
    }
    setRunnerDropdownOpen(false);
    setRunnerActiveIndex(-1);
    setDraft((prev) => {
      const matchingRaceDistance = found.distances?.find(
        (d) => d.label.trim().toLowerCase() === (prev.distance || '').trim().toLowerCase(),
      )?.label;
      const nextDistance = capText(
        (hadDirectoryRunner ? found.distances?.[0]?.label : matchingRaceDistance || found.distances?.[0]?.label) ||
          prev.distance ||
          '10K',
        HIGHLIGHT_CAPS.distance,
      );
      const waveStart = formatHighlightClockTime(
        getWaveStartTime(found, nextDistance, prev.mode === 'duo' ? 'duo' : undefined),
      );
      const nextGunTime = waveStart || prev.gunTime || '';
      const nextChipTime = hadDirectoryRunner ? '' : computeElapsedHmsFromClockPair(nextGunTime, prev.splitPace) || prev.chipTime;
      const km = parseDistanceKm(nextDistance, found);
      const nextPace =
        hadDirectoryRunner
          ? ''
          : km > 0 && nextChipTime
            ? computeHighlightPace(nextChipTime, km) || prev.pace
            : prev.pace;
      return {
        ...prev,
        ...(hadDirectoryRunner
          ? {
              runnerName: '',
              bibNumber: '',
              placement: '1st',
              splitPace: '',
              soloSplitTime: '',
              partnerName: '',
              partnerBibNumber: '',
              partnerSplitTime: '',
              combinedAvgPace: '',
            }
          : {}),
        raceId: found.id,
        raceName: found.name.slice(0, HIGHLIGHT_CAPS.raceName),
        raceDate: found.date,
        raceCode: deriveRaceCode(found.name, found.date),
        distance: nextDistance,
        gunTime: nextGunTime,
        chipTime: nextChipTime,
        pace: nextPace,
      };
    });
  };

  const handleDistanceChange = (nextDistance: string) => {
    if (activeRunner && draft.raceId) {
      const matchingByDist = activeRunner.entries.find(
        (e) =>
          e.raceId === draft.raceId &&
          e.distance.trim().toLowerCase() === nextDistance.trim().toLowerCase(),
      );
      if (matchingByDist) {
        applyRunnerRaceEntry(matchingByDist, activeRunner);
        return;
      }
    }
    setDraft((prev) => {
      const waveStart = selectedRace
        ? formatHighlightClockTime(
            getWaveStartTime(selectedRace, nextDistance, prev.mode === 'duo' ? 'duo' : undefined),
          )
        : '';
      const nextGunTime = waveStart || prev.gunTime || '';
      const elapsedFromClock = computeElapsedHmsFromClockPair(nextGunTime, prev.splitPace);
      const nextChipTime = elapsedFromClock || prev.chipTime;
      const km = parseDistanceKm(nextDistance, selectedRace || undefined);
      const nextPace = km > 0 && nextChipTime ? computeHighlightPace(nextChipTime, km) || prev.pace : prev.pace;
      return {
        ...prev,
        distance: capText(nextDistance, HIGHLIGHT_CAPS.distance),
        gunTime: nextGunTime,
        chipTime: nextChipTime,
        pace: nextPace,
      };
    });
  };

  const handleSelectBorderPreset = (presetId: HighlightBorderPreset) => {
    const meta = HIGHLIGHT_BORDER_PRESETS.find((p) => p.id === presetId);
    setDraft((prev) => ({
      ...prev,
      borderPreset: presetId,
      accentColor: meta?.defaultAccent || prev.accentColor,
      secondaryAccentColor: meta?.defaultSecondaryAccent || meta?.defaultAccent || prev.secondaryAccentColor,
    }));
  };

  const handleSaveHighlight = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;

    if (races.length > 0 && !draft.raceId) {
      notify({
        title: 'Source race required',
        message: 'Select an existing race event before publishing.',
        tone: 'error',
      });
      return;
    }

    const isGroup = draft.mode === 'group';
    const populatedMembers = isGroup
      ? (draft.groupMembers || []).filter(
          (m) => m.name.trim() || m.bibNumber?.trim() || m.photoUrl?.trim(),
        )
      : [];
    const fallbackGroupPhoto = isGroup
      ? draft.photoUrl || populatedMembers.find((m) => m.photoUrl?.trim())?.photoUrl?.trim() || ''
      : '';

    if (isGroup) {
      if (draft.groupPhotoLayout === 'single' && !fallbackGroupPhoto) {
        notify({
          title: 'Group photo required',
          message: 'Upload or attach a group photo before publishing.',
          tone: 'error',
        });
        return;
      }
      if (draft.groupPhotoLayout !== 'single' && !fallbackGroupPhoto) {
        notify({
          title: 'Photo required',
          message: 'Attach at least one member photo or switch to Single Group Photo.',
          tone: 'error',
        });
        return;
      }
      const hasTitle = Boolean(
        draft.teamName?.trim() || populatedMembers.some((m) => m.name.trim()) || draft.runnerName.trim(),
      );
      if (!hasTitle || !draft.chipTime.trim() || !draft.raceName.trim()) {
        notify({
          title: 'Missing group details',
          message: 'Enter a squad name or member names, finish time, and race event.',
          tone: 'error',
        });
        return;
      }
    } else {
      if (!draft.photoUrl) {
        notify({ title: 'Photo required', message: 'Upload or attach a runner photo first.', tone: 'error' });
        return;
      }
      if (draft.mode === 'duo' && !draft.partnerPhotoUrl) {
        notify({ title: 'Second photo required', message: 'Duo highlights require both runner photos.', tone: 'error' });
        return;
      }
      if (!draft.runnerName.trim() || !draft.bibNumber.trim() || !draft.chipTime.trim() || !draft.raceName.trim()) {
        notify({ title: 'Missing details', message: 'Enter runner name, bib, finish time, and race event.', tone: 'error' });
        return;
      }
      if (draft.mode === 'duo' && !draft.partnerName?.trim()) {
        notify({ title: 'Partner name required', message: 'Enter the second runner name for Duo mode.', tone: 'error' });
        return;
      }
    }

    setSavingHighlight(true);
    try {
      const targetId = editingId || draft.id || `hl_${Date.now().toString(36)}`;
      let finalPrimaryUrl = draft.photoUrl;
      let finalPartnerUrl = draft.partnerPhotoUrl;
      let finalGroupMembers = draft.groupMembers;

      if (finalPrimaryUrl && finalPrimaryUrl.startsWith('data:')) {
        finalPrimaryUrl = await uploadHighlightAsset(profile.uid, targetId, 'primary', finalPrimaryUrl);
      }
      if (draft.mode === 'duo' && finalPartnerUrl && finalPartnerUrl.startsWith('data:')) {
        finalPartnerUrl = await uploadHighlightAsset(profile.uid, targetId, 'partner', finalPartnerUrl);
      }
      if (isGroup && Array.isArray(draft.groupMembers)) {
        finalGroupMembers = await Promise.all(
          draft.groupMembers.map(async (member, idx) => {
            const url = (member.photoUrl || '').trim();
            if (url && url.startsWith('data:')) {
              const uploaded = await uploadHighlightAsset(profile.uid, targetId, `member-${idx + 1}`, url);
              return { ...member, photoUrl: uploaded };
            }
            return member;
          }),
        );
        if (!finalPrimaryUrl) {
          finalPrimaryUrl = finalGroupMembers.find((m) => m.photoUrl?.trim())?.photoUrl?.trim() || '';
        }
      }

      const resolvedRunnerName = isGroup
        ? draft.runnerName.trim() || draft.teamName?.trim() || populatedMembers[0]?.name.trim() || 'Group Finisher'
        : draft.runnerName;
      const resolvedBibNumber = isGroup
        ? draft.bibNumber.trim() || populatedMembers.find((m) => m.bibNumber?.trim())?.bibNumber?.trim() || 'TEAM'
        : draft.bibNumber;

      const saved = await saveRunnerHighlight({
        ...draft,
        id: targetId,
        runnerName: resolvedRunnerName,
        bibNumber: resolvedBibNumber,
        photoUrl: finalPrimaryUrl,
        partnerPhotoUrl: finalPartnerUrl,
        groupMembers: isGroup ? finalGroupMembers : undefined,
        createdBy: draft.createdBy || profile.uid,
      });

      notify({
        title: editingId ? 'Highlight updated' : 'Highlight published',
        message: `${getHighlightDisplayTitle(saved)} is now scheduled for the Podium Highlights reel.`,
        tone: 'success',
      });
      setEditingId(null);
      setSelectedRunnerKey(null);
      setRunnerDropdownOpen(false);
      setPartnerDropdownOpen(false);
      setStudioDistanceFilter('all');
      setComposerSection('athlete');
      setDraft(createBlankDraft(profile.uid));
    } catch (err) {
      notify({
        title: 'Save failed',
        message: err instanceof Error ? err.message : 'Unable to save highlight.',
        tone: 'error',
      });
    } finally {
      setSavingHighlight(false);
    }
  };

  const handleEditHighlight = (item: RunnerHighlight) => {
    setEditingId(item.id);
    setSelectedRunnerKey(normalizeRunnerKey(item.runnerName) || null);
    setRunnerDropdownOpen(false);
    setPartnerDropdownOpen(false);
    setStudioDistanceFilter('all');
    setComposerSection('athlete');
    setDraft({
      ...item,
      achievements: item.achievements ? [...item.achievements] : [],
      participatedEvents: item.participatedEvents ? [...item.participatedEvents] : [],
      groupPhotoLayout: item.groupPhotoLayout || 'collage',
      groupMembers:
        item.mode === 'group' && (!item.groupMembers || item.groupMembers.length === 0)
          ? [{ name: item.runnerName, bibNumber: item.bibNumber, photoUrl: item.photoUrl }]
          : item.groupMembers,
      secondaryAccentColor: item.secondaryAccentColor || '#ff3b30',
      cardEffect: item.cardEffect || 'sheen-sweep',
      headerStyle: item.headerStyle || 'crown-bezel',
      borderWidthPx: clampNumber(item.borderWidthPx ?? 3, 2, 6),
      scrimStrength: clampNumber(item.scrimStrength ?? 78, 30, 95),
    });
    setSubTab('studio');
  };

  const handleDuplicateHighlight = (item: RunnerHighlight) => {
    const now = new Date().toISOString();
    setEditingId(null);
    setSelectedRunnerKey(normalizeRunnerKey(item.runnerName) || null);
    setRunnerDropdownOpen(false);
    setPartnerDropdownOpen(false);
    setStudioDistanceFilter('all');
    setComposerSection('athlete');
    setDraft({
      ...item,
      id: `hl_${Date.now().toString(36)}`,
      achievements: item.achievements ? [...item.achievements] : [],
      participatedEvents: item.participatedEvents ? [...item.participatedEvents] : [],
      groupPhotoLayout: item.groupPhotoLayout || 'collage',
      secondaryAccentColor: item.secondaryAccentColor || '#ff3b30',
      cardEffect: item.cardEffect || 'sheen-sweep',
      headerStyle: item.headerStyle || 'crown-bezel',
      borderWidthPx: clampNumber(item.borderWidthPx ?? 3, 2, 6),
      scrimStrength: clampNumber(item.scrimStrength ?? 78, 30, 95),
      pinned: false,
      createdAt: now,
      updatedAt: now,
    });
    setSubTab('studio');
    notify({ title: 'Duplicated to studio', message: 'Update runner details and publish when ready.', tone: 'info' });
  };

  const handleTogglePin = async (item: RunnerHighlight) => {
    if (!canManage) return;
    try {
      await saveRunnerHighlight({ ...item, pinned: !item.pinned });
      notify({
        title: !item.pinned ? 'Pinned to front' : 'Unpinned highlight',
        message: item.runnerName,
        tone: 'success',
      });
    } catch {
      notify({ title: 'Pin update failed', tone: 'error' });
    }
  };

  const handleDeleteHighlight = async (item: RunnerHighlight) => {
    if (!canManage) return;
    const confirmed = await confirm({
      title: 'Remove highlight?',
      message: `Remove ${item.runnerName} (${item.raceName}) from the landing page podium reel?`,
      confirmLabel: 'Remove highlight',
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await deleteRunnerHighlight(item.id);
      if (editingId === item.id) {
        setEditingId(null);
        setSelectedRunnerKey(null);
        setRunnerDropdownOpen(false);
        setPartnerDropdownOpen(false);
        setDraft(createBlankDraft(profile.uid));
      }
      notify({ title: 'Highlight removed', message: item.runnerName, tone: 'info' });
    } catch {
      notify({ title: 'Could not remove highlight', tone: 'error' });
    }
  };

  const handleSaveDeck = async () => {
    if (!canSettings) return;
    setSavingConfig(true);
    try {
      await saveHighlightsMarqueeConfig(config, {
        actorUid: profile.uid,
        includePlaylistRules: canPlaylist,
      });
      notify({
        title: 'Marquee controls saved',
        message: 'Landing page scroll physics and layout settings updated.',
        tone: 'success',
      });
    } catch (err) {
      notify({
        title: 'Could not save marquee settings',
        message: err instanceof Error ? err.message : 'Check access permissions.',
        tone: 'error',
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const chipBtn = (active: boolean) =>
    `min-h-11 px-3 py-2 rounded-xl border text-xs font-semibold transition inline-flex items-center justify-center gap-1.5 ${
      active
        ? 'bg-red-700 text-white border-red-800 shadow-sm'
        : 'bg-[var(--surface-card)] text-[var(--text-primary)] border-[var(--border-default)] hover:bg-[var(--surface-hover)]'
    }`;

  return (
    <div className="space-y-5">
      {/* Section Header & Sub-Navigation */}
      <div className="glass-panel p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="type-section text-[var(--text-primary)] flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
            <span>Podium Highlights Studio</span>
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1">
            Publish collectible Solo, Duo &amp; Group finisher cards and tune the landing page marquee physics.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0" role="tablist" aria-label="Highlights workspace views">
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'studio'}
            onClick={() => setSubTab('studio')}
            className={chipBtn(subTab === 'studio')}
          >
            <Layers className="w-4 h-4" aria-hidden="true" />
            <span>{editingId ? 'Edit Card' : 'Highlight Studio'}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'published'}
            onClick={() => setSubTab('published')}
            className={chipBtn(subTab === 'published')}
          >
            <Award className="w-4 h-4" aria-hidden="true" />
            <span>Published ({highlights.length})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'deck'}
            onClick={() => setSubTab('deck')}
            className={chipBtn(subTab === 'deck')}
          >
            <Sliders className="w-4 h-4" aria-hidden="true" />
            <span>Control Deck</span>
          </button>
        </div>
      </div>

      {!canManage && !canSettings && (
        <div role="status" className="glass-inset px-4 py-3 text-sm text-[var(--text-secondary)]">
          Read-only access: ask a Super Admin to enable Manage Highlights or Marquee Control Deck in Access controls.
        </div>
      )}

      {/* TAB 1: SYNERGIZED STUDIO WORKSPACE */}
      {subTab === 'studio' && (
        <form onSubmit={handleSaveHighlight} className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* Hidden File Inputs kept mounted across composer sections */}
          <input
            ref={primaryFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleSelectFile({ kind: 'primary' }, e)}
          />
          <input
            ref={partnerFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleSelectFile({ kind: 'partner' }, e)}
          />
          <input
            ref={groupMemberFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) =>
              handleSelectFile({ kind: 'group-member', index: pendingGroupMemberIndexRef.current }, e)
            }
          />

          {/* LEFT + CENTER COMPOSER: Stepped Athlete, Career & Frame FX */}
          <div className="xl:col-span-8 glass-panel p-4 sm:p-5 space-y-5 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-default)] pb-3">
              <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Studio composer sections">
                <button
                  type="button"
                  role="tab"
                  aria-selected={composerSection === 'athlete'}
                  onClick={() => setComposerSection('athlete')}
                  className={chipBtn(composerSection === 'athlete')}
                >
                  <Users className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>1. Athlete &amp; Timing</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={composerSection === 'career'}
                  onClick={() => setComposerSection('career')}
                  className={chipBtn(composerSection === 'career')}
                >
                  <Trophy className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    2. Events &amp; Achievements
                    {((draft.achievements?.length || 0) + (draft.participatedEvents?.length || 0)) > 0
                      ? ` (${draft.achievements?.length || 0}/${draft.participatedEvents?.length || 0})`
                      : ''}
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={composerSection === 'style'}
                  onClick={() => setComposerSection('style')}
                  className={chipBtn(composerSection === 'style')}
                >
                  <Palette className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>3. Frame &amp; Visual FX</span>
                </button>
              </div>

              <div
                role="group"
                aria-label="Highlight entry category"
                className="inline-flex rounded-xl border border-[var(--border-default)] p-1 bg-[var(--surface-inset)] self-start sm:self-auto"
              >
                {(['solo', 'duo', 'group'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={!canManage}
                    aria-pressed={draft.mode === mode}
                    onClick={() => handleSwitchHighlightMode(mode)}
                    className={`min-h-10 px-3 rounded-lg text-xs font-mono font-semibold uppercase transition ${
                      draft.mode === mode
                        ? 'bg-red-700 text-white'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {composerSection === 'athlete' && (
              <section className="space-y-4" aria-label="Race source and runner selection">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                    Race Source &amp; Ranked Finisher
                  </h2>
                  <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                    {rankedRaceEntries.length} finishers in view
                  </span>
                </div>

                {/* Required Source Race Selector & Distance Filter */}
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5 space-y-3">
                  <HighlightCustomSelect
                    id="hl-race-link"
                    label={races.length > 0 ? 'Source Race Event (Required)' : 'Source Race Event'}
                    value={draft.raceId}
                    disabled={!canManage || races.length === 0}
                    searchable
                    searchPlaceholder="Filter race events by name or date..."
                    placeholder="Select synced race event"
                    options={
                      races.length === 0
                        ? [{ value: '', label: 'No synced races found', disabled: true }]
                        : races.map((race) => ({
                            value: race.id,
                            label: race.name,
                            sublabel: race.date,
                            badge: `${raceRunnerCounts[race.id] || 0} runners`,
                            accentDot: race.id === draft.raceId ? '#dc2626' : undefined,
                          }))
                    }
                    onChange={handleLinkedRaceChange}
                  />

                  {raceFilterDistances.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="block text-[11px] font-mono text-[var(--text-secondary)]">
                        Distance Filter
                      </span>
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter race runners by distance">
                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={() => setStudioDistanceFilter('all')}
                          className={`min-h-9 px-2.5 rounded-lg border text-xs font-mono transition ${
                            studioDistanceFilter === 'all'
                              ? 'bg-red-700 text-white border-red-800'
                              : 'bg-[var(--surface-card)] text-[var(--text-secondary)] border-[var(--border-default)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          All
                        </button>
                        {raceFilterDistances.map((dist) => {
                          const activeDist = studioDistanceFilter.toLowerCase() === dist.toLowerCase();
                          return (
                            <button
                              key={dist}
                              type="button"
                              disabled={!canManage}
                              onClick={() => {
                                setStudioDistanceFilter(dist);
                                if (!selectedRunnerKey) {
                                  handleDistanceChange(dist);
                                }
                              }}
                              className={`min-h-9 px-2.5 rounded-lg border text-xs font-mono transition ${
                                activeDist
                                  ? 'bg-red-700 text-white border-red-800'
                                  : 'bg-[var(--surface-card)] text-[var(--text-secondary)] border-[var(--border-default)] hover:text-[var(--text-primary)]'
                              }`}
                            >
                              {dist}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Sort Mode + Top Ranked Quick-Picks */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-[var(--border-default)]">
                    <label htmlFor="hl-runner-sort" className="text-[11px] font-mono text-[var(--text-secondary)]">
                      Order Directory By
                    </label>
                    <div className="w-full sm:w-56">
                      <HighlightCustomSelect
                        id="hl-runner-sort"
                        ariaLabel="Order Directory By"
                        compact
                        disabled={!canManage}
                        value={runnerSortBy}
                        options={[
                          { value: 'rank', label: 'Rank (1st to Nth)', badge: 'Default' },
                          { value: 'time', label: 'Fastest Finish Time' },
                          { value: 'name', label: 'Name (A-Z)' },
                          { value: 'bib', label: 'Bib Number' },
                        ]}
                        onChange={(val) => setRunnerSortBy(val as HighlightRunnerSortMode)}
                      />
                    </div>
                  </div>

              {podiumQuickPicks.length > 0 && (
                <div className="space-y-1.5">
                  <span className="block text-[11px] font-mono text-[var(--text-secondary)]">
                    Podium Quick-Picks
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {podiumQuickPicks.map((item, idx) => {
                      const rankNum = item.entry.rank ?? idx + 1;
                      const isActive =
                        activeRunner?.key === item.runner.key &&
                        draft.bibNumber.trim().toUpperCase() === item.entry.bibNumber.trim().toUpperCase();
                      return (
                        <button
                          key={`qp:${item.entry.raceId}:${item.entry.bibNumber}`}
                          type="button"
                          disabled={!canManage}
                          onClick={() => handleSelectRankedEntry(item)}
                          title={`${item.runner.fullName} | ${item.entry.distance} | ${item.entry.chipTime || 'No time'}`}
                          className={`min-h-9 px-2.5 py-1 rounded-lg border text-[11px] font-mono transition inline-flex items-center gap-1.5 ${
                            isActive
                              ? 'bg-red-700 text-white border-red-800 shadow-sm'
                              : 'bg-[var(--surface-card)] text-[var(--text-primary)] border-[var(--border-default)] hover:bg-[var(--surface-hover)]'
                          }`}
                        >
                          <span className="font-bold">#{rankNum}</span>
                          <span className="truncate max-w-[116px]">{item.runner.fullName}</span>
                          <span className="opacity-80">{item.entry.distance}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Single, Duo, or Group Single Upload Slots */}
            {(draft.mode !== 'group' || draft.groupPhotoLayout === 'single') && (
              <div className={`grid gap-3 ${draft.mode === 'duo' ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono font-semibold text-[var(--text-secondary)]">
                      {draft.mode === 'duo'
                        ? 'Runner 1 Photo'
                        : draft.mode === 'group'
                          ? 'Single Group Photo'
                          : 'Runner Portrait'}
                    </span>
                    {matchedPrimaryAccount.photoUrl && (
                      <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400">
                        Account photo found
                      </span>
                    )}
                  </div>
                  {draft.photoUrl && (
                    <img
                      src={draft.photoUrl}
                      alt="Selected primary highlight"
                      className="w-full h-28 object-cover rounded-lg border border-[var(--border-default)]"
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!canManage}
                      onClick={() => primaryFileRef.current?.click()}
                      className="h-11 px-3 text-xs flex-1"
                    >
                      <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{draft.photoUrl ? 'Replace' : 'Upload'}</span>
                    </Button>
                    {draft.photoUrl && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!canManage}
                        onClick={() => setCropSession({ target: { kind: 'primary' }, sourceUrl: draft.photoUrl })}
                        className="h-11 px-3 text-xs"
                      >
                        Crop
                      </Button>
                    )}
                  </div>

                  {(matchedPrimaryAccount.photoUrl || canViewUsers || availableAccounts.length > 0) && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {matchedPrimaryAccount.photoUrl && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!canManage}
                          onClick={() =>
                            applyPhotoToSlot(
                              { kind: 'primary' },
                              matchedPrimaryAccount.photoUrl!,
                              matchedPrimaryAccount.account,
                            )
                          }
                          className="h-11 px-3 text-xs flex-1"
                        >
                          <img
                            src={matchedPrimaryAccount.photoUrl}
                            alt=""
                            className="w-5 h-5 rounded-full object-cover border border-[var(--border-default)] shrink-0"
                          />
                          <span>
                            {draft.photoUrl === matchedPrimaryAccount.photoUrl
                              ? 'Account Photo Active'
                              : 'Use Account Photo'}
                          </span>
                        </Button>
                      )}
                      {(canViewUsers || availableAccounts.length > 0) && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!canManage || availableAccounts.length === 0}
                          onClick={() => handleOpenAccountPicker({ kind: 'primary' })}
                          className="h-11 px-3 text-xs"
                        >
                          <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Account Photo</span>
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {draft.mode === 'duo' && (
                  <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono font-semibold text-[var(--text-secondary)]">
                        Runner 2 Photo
                      </span>
                      {matchedPartnerAccount.photoUrl && (
                        <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400">
                          Account photo found
                        </span>
                      )}
                    </div>
                    {draft.partnerPhotoUrl && (
                      <img
                        src={draft.partnerPhotoUrl}
                        alt="Selected partner runner"
                        className="w-full h-28 object-cover rounded-lg border border-[var(--border-default)]"
                      />
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!canManage}
                        onClick={() => partnerFileRef.current?.click()}
                        className="h-11 px-3 text-xs flex-1"
                      >
                        <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{draft.partnerPhotoUrl ? 'Replace' : 'Upload'}</span>
                      </Button>
                      {draft.partnerPhotoUrl && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!canManage}
                          onClick={() =>
                            setCropSession({ target: { kind: 'partner' }, sourceUrl: draft.partnerPhotoUrl || '' })
                          }
                          className="h-11 px-3 text-xs"
                        >
                          Crop
                        </Button>
                      )}
                    </div>

                    {(matchedPartnerAccount.photoUrl || canViewUsers || availableAccounts.length > 0) && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {matchedPartnerAccount.photoUrl && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!canManage}
                            onClick={() =>
                              applyPhotoToSlot(
                                { kind: 'partner' },
                                matchedPartnerAccount.photoUrl!,
                                matchedPartnerAccount.account,
                              )
                            }
                            className="h-11 px-3 text-xs flex-1"
                          >
                            <img
                              src={matchedPartnerAccount.photoUrl}
                              alt=""
                              className="w-5 h-5 rounded-full object-cover border border-[var(--border-default)] shrink-0"
                            />
                            <span>
                              {draft.partnerPhotoUrl === matchedPartnerAccount.photoUrl
                                ? 'Account Photo Active'
                                : 'Use Account Photo'}
                            </span>
                          </Button>
                        )}
                        {(canViewUsers || availableAccounts.length > 0) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!canManage || availableAccounts.length === 0}
                            onClick={() => handleOpenAccountPicker({ kind: 'partner' })}
                            className="h-11 px-3 text-xs"
                          >
                            <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Account Photo</span>
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Group Setup & Members */}
            {draft.mode === 'group' && (
              <fieldset className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5 space-y-3">
                <legend className="px-1.5 text-xs font-mono font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                  <span>Group Setup &amp; Members</span>
                </legend>

                <div className="space-y-1.5">
                  <span className="block text-xs font-mono text-[var(--text-secondary)]">Group Photo Layout</span>
                  <div className="grid grid-cols-2 gap-2" role="group" aria-label="Group photo layout">
                    <button
                      type="button"
                      disabled={!canManage}
                      aria-pressed={(draft.groupPhotoLayout || 'collage') === 'collage'}
                      onClick={() => setDraft((p) => ({ ...p, groupPhotoLayout: 'collage' }))}
                      className={chipBtn((draft.groupPhotoLayout || 'collage') === 'collage')}
                    >
                      <span>Member Collage</span>
                    </button>
                    <button
                      type="button"
                      disabled={!canManage}
                      aria-pressed={draft.groupPhotoLayout === 'single'}
                      onClick={() => setDraft((p) => ({ ...p, groupPhotoLayout: 'single' }))}
                      className={chipBtn(draft.groupPhotoLayout === 'single')}
                    >
                      <span>Single Group Photo</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label htmlFor="hl-team-name" className="text-xs font-mono text-[var(--text-secondary)]">
                    Group / Team Name
                  </label>
                  <Input
                    id="hl-team-name"
                    value={draft.teamName || ''}
                    maxLength={HIGHLIGHT_CAPS.teamName}
                    disabled={!canManage}
                    placeholder="Sugakod Relay Squad"
                    onChange={(e) => setDraft((p) => ({ ...p, teamName: e.target.value }))}
                    className="h-11 text-sm"
                  />
                </div>

                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono font-semibold text-[var(--text-secondary)]">
                      Members ({(draft.groupMembers || []).length}/6)
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!canManage || (draft.groupMembers || []).length >= 6}
                      onClick={handleAddGroupMember}
                      className="h-11 px-3 text-xs"
                    >
                      <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Add Member</span>
                    </Button>
                  </div>

                  <div className="space-y-2.5">
                    {(draft.groupMembers || []).map((member, idx) => {
                      const matchedMemberAcc = resolveRunnerAccountPhoto({
                        uid: member.uid,
                        fullName: member.name,
                        userPhotosByUid: runnerSources.userPhotosByUid,
                        userAccounts: availableAccounts,
                      });
                      const memberHasUrl = Boolean(member.photoUrl?.trim());
                      return (
                        <div
                          key={`group-member-${idx}`}
                          className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-2.5 space-y-2"
                        >
                          <div className="flex items-center gap-2">
                            {memberHasUrl ? (
                              <img
                                src={member.photoUrl}
                                alt={member.name || `Member ${idx + 1}`}
                                className="w-11 h-11 rounded-lg object-cover border border-[var(--border-default)] shrink-0"
                              />
                            ) : (
                              <div className="w-11 h-11 rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--surface-inset)] flex items-center justify-center text-xs font-mono text-[var(--text-secondary)] shrink-0">
                                {idx + 1}
                              </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 flex-1 min-w-0">
                              <Input
                                aria-label={`Member ${idx + 1} name`}
                                value={member.name}
                                maxLength={HIGHLIGHT_CAPS.runnerName}
                                disabled={!canManage}
                                placeholder={`Member ${idx + 1} name`}
                                onChange={(e) => handleUpdateGroupMember(idx, { name: e.target.value })}
                                className="sm:col-span-7 h-11 text-xs px-2.5"
                              />
                              <Input
                                aria-label={`Member ${idx + 1} bib`}
                                value={member.bibNumber || ''}
                                maxLength={HIGHLIGHT_CAPS.bibNumber}
                                disabled={!canManage}
                                placeholder="Bib #"
                                onChange={(e) => handleUpdateGroupMember(idx, { bibNumber: e.target.value })}
                                className="sm:col-span-5 h-11 font-mono text-xs px-2.5"
                              />
                            </div>

                            <button
                              type="button"
                              disabled={!canManage || (draft.groupMembers || []).length <= 1}
                              onClick={() => handleRemoveGroupMember(idx)}
                              aria-label={`Remove member ${idx + 1}`}
                              className="min-h-11 min-w-11 shrink-0 rounded-lg border border-[var(--border-default)] flex items-center justify-center text-[var(--text-secondary)] hover:text-red-700 disabled:opacity-40"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={!canManage}
                              onClick={() => {
                                pendingGroupMemberIndexRef.current = idx;
                                groupMemberFileRef.current?.click();
                              }}
                              className="h-11 px-3 text-xs"
                            >
                              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>{memberHasUrl ? 'Replace' : 'Upload'}</span>
                            </Button>

                            {memberHasUrl && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={!canManage}
                                onClick={() =>
                                  setCropSession({
                                    target: { kind: 'group-member', index: idx },
                                    sourceUrl: member.photoUrl || '',
                                  })
                                }
                                className="h-11 px-3 text-xs"
                              >
                                Crop
                              </Button>
                            )}

                            {matchedMemberAcc.photoUrl && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={!canManage}
                                onClick={() =>
                                  applyPhotoToSlot(
                                    { kind: 'group-member', index: idx },
                                    matchedMemberAcc.photoUrl!,
                                    matchedMemberAcc.account,
                                  )
                                }
                                className="h-11 px-3 text-xs"
                              >
                                <img
                                  src={matchedMemberAcc.photoUrl}
                                  alt=""
                                  className="w-4 h-4 rounded-full object-cover border border-[var(--border-default)] shrink-0"
                                />
                                <span>
                                  {member.photoUrl === matchedMemberAcc.photoUrl
                                    ? 'Account Photo Active'
                                    : 'Use Account Photo'}
                                </span>
                              </Button>
                            )}

                            {(canViewUsers || availableAccounts.length > 0) && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={!canManage || availableAccounts.length === 0}
                                onClick={() => handleOpenAccountPicker({ kind: 'group-member', index: idx })}
                                className="h-11 px-3 text-xs"
                              >
                                <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Account Photo</span>
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </fieldset>
            )}

            {/* Runner Identity Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div
                className="sm:col-span-2 space-y-1 relative"
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setRunnerDropdownOpen(false);
                    setRunnerActiveIndex(-1);
                  }
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="hl-runner-name" className="text-xs font-mono text-[var(--text-secondary)]">
                    {draft.mode === 'duo'
                      ? 'Runner 1 Name'
                      : draft.mode === 'group'
                        ? 'Lead Runner (Database Autofill)'
                        : 'Runner Name'}
                  </label>
                  {activeRunner ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
                      <Database className="w-3 h-3" aria-hidden="true" />
                      <span>
                        {matchedActiveEntry?.rank != null ? `#${matchedActiveEntry.rank} · ` : ''}
                        {activeRunner.entries.length} {activeRunner.entries.length === 1 ? 'race' : 'races'}
                      </span>
                    </span>
                  ) : rankedRaceEntries.length > 0 ? (
                    <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                      {rankedRaceEntries.length} in race
                    </span>
                  ) : null}
                </div>
                <div className="relative">
                  <Input
                    id="hl-runner-name"
                    role="combobox"
                    autoComplete="off"
                    aria-autocomplete="list"
                    aria-expanded={runnerDropdownOpen}
                    aria-controls="hl-runner-listbox"
                    aria-activedescendant={
                      runnerDropdownOpen && runnerActiveIndex >= 0 ? `hl-runner-opt-${runnerActiveIndex}` : undefined
                    }
                    value={draft.runnerName}
                    maxLength={HIGHLIGHT_CAPS.runnerName}
                    disabled={!canManage}
                    placeholder="Search ranked runner or pick #1..."
                    onFocus={() => {
                      if (canManage) setRunnerDropdownOpen(true);
                    }}
                    onChange={(e) => {
                      setSelectedRunnerKey(null);
                      setRunnerDropdownOpen(true);
                      setRunnerActiveIndex(-1);
                      setDraft((p) => ({ ...p, runnerName: e.target.value }));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setRunnerDropdownOpen(true);
                        setRunnerActiveIndex((idx) =>
                          filteredRunnerSuggestions.length === 0 ? -1 : (idx + 1) % filteredRunnerSuggestions.length,
                        );
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setRunnerDropdownOpen(true);
                        setRunnerActiveIndex((idx) =>
                          filteredRunnerSuggestions.length === 0
                            ? -1
                            : (idx - 1 + filteredRunnerSuggestions.length) % filteredRunnerSuggestions.length,
                        );
                      } else if (e.key === 'Enter' && runnerDropdownOpen && runnerActiveIndex >= 0) {
                        const picked = filteredRunnerSuggestions[runnerActiveIndex];
                        if (picked) {
                          e.preventDefault();
                          handleSelectRankedEntry(picked);
                        }
                      } else if (e.key === 'Escape') {
                        setRunnerDropdownOpen(false);
                        setRunnerActiveIndex(-1);
                      }
                    }}
                    className="h-11 pr-11 text-sm"
                  />
                  <button
                    type="button"
                    disabled={!canManage}
                    aria-label="Toggle ranked runner directory"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setRunnerDropdownOpen((prev) => !prev)}
                    className="absolute right-0 top-0 h-11 w-11 inline-flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-r-xl"
                  >
                    <ChevronDown
                      className={`w-4 h-4 transition-transform ${runnerDropdownOpen ? 'rotate-180' : ''}`}
                      aria-hidden="true"
                    />
                  </button>
                </div>

                {runnerDropdownOpen && canManage && (
                  <div
                    id="hl-runner-listbox"
                    role="listbox"
                    aria-label="Ranked database runners"
                    className="absolute left-0 right-0 top-full mt-1 z-30 max-h-64 overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-xl p-1 space-y-1"
                  >
                    {filteredRunnerSuggestions.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-[var(--text-secondary)] flex items-center gap-2">
                        <Search className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          {runnerDirectory.length === 0
                            ? 'No roster runners synced yet. Type details manually.'
                            : `No runner match for "${draft.runnerName.trim() || studioDistanceFilter}" in this race.`}
                        </span>
                      </div>
                    ) : (
                      filteredRunnerSuggestions.map((item, idx) => {
                        const { runner, entry } = item;
                        const isSelected =
                          activeRunner?.key === runner.key &&
                          draft.bibNumber.trim().toUpperCase() === entry.bibNumber.trim().toUpperCase();
                        const isHighlighted = idx === runnerActiveIndex;
                        const rankLabel =
                          entry.rank != null ? `#${entry.rank}` : entry.disqualified ? 'DQ' : 'REG';
                        return (
                          <button
                            key={`${runner.key}:${entry.raceId}:${entry.bibNumber}`}
                            id={`hl-runner-opt-${idx}`}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseEnter={() => setRunnerActiveIndex(idx)}
                            onClick={() => handleSelectRankedEntry(item)}
                            className={`w-full min-h-11 text-left px-3 py-2 rounded-lg border transition flex flex-col gap-0.5 ${
                              isSelected || isHighlighted
                                ? 'border-red-600/60 bg-red-500/10'
                                : 'border-transparent hover:bg-[var(--surface-hover)]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                                    entry.rank != null && entry.rank <= 3
                                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                      : 'bg-[var(--surface-inset)] text-[var(--text-secondary)] border border-[var(--border-default)]'
                                  }`}
                                >
                                  {rankLabel}
                                </span>
                                {(entry.photoUrl || runner.photoUrl) && (
                                  <img
                                    src={entry.photoUrl || runner.photoUrl}
                                    alt=""
                                    className="w-5 h-5 rounded-full object-cover border border-[var(--border-default)] shrink-0"
                                  />
                                )}
                                <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                                  {runner.fullName}
                                </span>
                              </div>
                              <span className="shrink-0 px-2 py-0.5 rounded bg-[var(--surface-inset)] border border-[var(--border-default)] text-[10px] font-mono text-[var(--text-secondary)]">
                                {entry.distance} · #{entry.bibNumber}
                              </span>
                            </div>
                            <span className="text-[11px] font-mono text-[var(--text-secondary)] truncate">
                              {entry.chipTime ? `${entry.chipTime} finish` : 'Registered (no finish scan)'}
                              {entry.pace ? ` · ${entry.pace}` : ''}
                              {entry.gunTime ? ` · Gun ${entry.gunTime}` : ''}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <label htmlFor="hl-bib-1" className="text-xs font-mono text-[var(--text-secondary)]">
                  Bib #
                </label>
                <Input
                  id="hl-bib-1"
                  value={draft.bibNumber}
                  maxLength={HIGHLIGHT_CAPS.bibNumber}
                  disabled={!canManage}
                  placeholder="21-014"
                  onChange={(e) => setDraft((p) => ({ ...p, bibNumber: e.target.value }))}
                  className="h-11 font-mono text-sm"
                />
              </div>
            </div>

            {draft.mode === 'duo' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div
                  className="sm:col-span-2 space-y-1 relative"
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                      setPartnerDropdownOpen(false);
                      setPartnerActiveIndex(-1);
                    }
                  }}
                >
                  <label htmlFor="hl-partner-name" className="text-xs font-mono text-[var(--text-secondary)]">
                    Runner 2 Name
                  </label>
                  <div className="relative">
                    <Input
                      id="hl-partner-name"
                      role="combobox"
                      autoComplete="off"
                      aria-autocomplete="list"
                      aria-expanded={partnerDropdownOpen}
                      aria-controls="hl-partner-listbox"
                      value={draft.partnerName || ''}
                      maxLength={HIGHLIGHT_CAPS.runnerName}
                      disabled={!canManage}
                      placeholder="Search partner name"
                      onFocus={() => {
                        if (canManage) setPartnerDropdownOpen(true);
                      }}
                      onChange={(e) => {
                        setPartnerDropdownOpen(true);
                        setPartnerActiveIndex(-1);
                        setDraft((p) => ({ ...p, partnerName: e.target.value }));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setPartnerDropdownOpen(true);
                          setPartnerActiveIndex((idx) =>
                            filteredPartnerSuggestions.length === 0 ? -1 : (idx + 1) % filteredPartnerSuggestions.length,
                          );
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setPartnerDropdownOpen(true);
                          setPartnerActiveIndex((idx) =>
                            filteredPartnerSuggestions.length === 0
                              ? -1
                              : (idx - 1 + filteredPartnerSuggestions.length) % filteredPartnerSuggestions.length,
                          );
                        } else if (e.key === 'Enter' && partnerDropdownOpen && partnerActiveIndex >= 0) {
                          const picked = filteredPartnerSuggestions[partnerActiveIndex];
                          if (picked) {
                            e.preventDefault();
                            handleSelectPartnerFromDirectory(picked);
                          }
                        } else if (e.key === 'Escape') {
                          setPartnerDropdownOpen(false);
                          setPartnerActiveIndex(-1);
                        }
                      }}
                      className="h-11 pr-11 text-sm"
                    />
                    <button
                      type="button"
                      disabled={!canManage}
                      aria-label="Toggle partner runner directory"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setPartnerDropdownOpen((prev) => !prev)}
                      className="absolute right-0 top-0 h-11 w-11 inline-flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-r-xl"
                    >
                      <ChevronDown
                        className={`w-4 h-4 transition-transform ${partnerDropdownOpen ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                      />
                    </button>
                  </div>

                  {partnerDropdownOpen && canManage && filteredPartnerSuggestions.length > 0 && (
                    <div
                      id="hl-partner-listbox"
                      role="listbox"
                      aria-label="Database partner runners"
                      className="absolute left-0 right-0 top-full mt-1 z-30 max-h-56 overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-xl p-1 space-y-1"
                    >
                      {filteredPartnerSuggestions.map((runner, idx) => {
                        const raceEntry = draft.raceId
                          ? runner.entries.find((e) => e.raceId === draft.raceId) || runner.entries[0]
                          : runner.entries[0];
                        return (
                          <button
                            key={runner.key}
                            type="button"
                            role="option"
                            aria-selected={normalizeRunnerKey(draft.partnerName) === runner.key}
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseEnter={() => setPartnerActiveIndex(idx)}
                            onClick={() => handleSelectPartnerFromDirectory(runner)}
                            className={`w-full min-h-11 text-left px-3 py-2 rounded-lg border transition flex flex-col gap-0.5 ${
                              idx === partnerActiveIndex
                                ? 'border-red-600/60 bg-red-500/10'
                                : 'border-transparent hover:bg-[var(--surface-hover)]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                {(raceEntry?.photoUrl || runner.photoUrl) && (
                                  <img
                                    src={raceEntry?.photoUrl || runner.photoUrl}
                                    alt=""
                                    className="w-5 h-5 rounded-full object-cover border border-[var(--border-default)] shrink-0"
                                  />
                                )}
                                <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                                  {runner.fullName}
                                </span>
                              </div>
                              {raceEntry && (
                                <span className="shrink-0 text-[10px] font-mono text-[var(--text-secondary)]">
                                  #{raceEntry.bibNumber} · {raceEntry.distance}
                                </span>
                              )}
                            </div>
                            {raceEntry && (
                              <span className="text-[11px] font-mono text-[var(--text-secondary)] truncate">
                                {raceEntry.raceName}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <label htmlFor="hl-bib-2" className="text-xs font-mono text-[var(--text-secondary)]">
                    Bib #2
                  </label>
                  <Input
                    id="hl-bib-2"
                    value={draft.partnerBibNumber || ''}
                    maxLength={HIGHLIGHT_CAPS.bibNumber}
                    disabled={!canManage}
                    placeholder="21-015"
                    onChange={(e) => setDraft((p) => ({ ...p, partnerBibNumber: e.target.value }))}
                    className="h-11 font-mono text-sm"
                  />
                </div>
              </div>
            )}

            {/* Placement & Distance */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <HighlightCustomSelect
                  id="hl-placement"
                  label="Placement"
                  disabled={!canManage}
                  value={matchedPlacementOption}
                  options={[
                    ...availablePlacements.map((pl) => ({ value: pl, label: pl })),
                    { value: 'custom', label: 'Custom label' },
                  ]}
                  onChange={(val) => {
                    if (val === 'custom') {
                      setDraft((p) => ({
                        ...p,
                        placement: availablePlacements.some(
                          (pl) => pl.toLowerCase() === p.placement.trim().toLowerCase(),
                        )
                          ? ''
                          : p.placement,
                      }));
                    } else {
                      setDraft((p) => ({ ...p, placement: val }));
                    }
                  }}
                />
                {matchedPlacementOption === 'custom' && (
                  <Input
                    value={draft.placement}
                    maxLength={HIGHLIGHT_CAPS.placement}
                    disabled={!canManage}
                    placeholder="e.g. Top 5 Female"
                    aria-label="Custom placement label"
                    onChange={(e) => setDraft((p) => ({ ...p, placement: e.target.value }))}
                    className="h-10 text-xs mt-1"
                  />
                )}
              </div>
              <div className="space-y-1">
                <HighlightCustomSelect
                  id="hl-distance"
                  label="Distance"
                  disabled={!canManage}
                  value={matchedDistanceOption}
                  options={[
                    ...availableDistances.map((d) => ({ value: d, label: d })),
                    ...(!selectedRace ? [{ value: 'custom', label: 'Custom distance' }] : []),
                  ]}
                  onChange={(val) => {
                    if (val === 'custom') {
                      setDraft((p) => ({
                        ...p,
                        distance: availableDistances.some(
                          (d) => d.toLowerCase() === p.distance.trim().toLowerCase(),
                        )
                          ? ''
                          : p.distance,
                      }));
                    } else {
                      handleDistanceChange(val);
                    }
                  }}
                />
                {!selectedRace && matchedDistanceOption === 'custom' && (
                  <Input
                    value={draft.distance}
                    maxLength={HIGHLIGHT_CAPS.distance}
                    disabled={!canManage}
                    placeholder="e.g. 15K"
                    aria-label="Custom distance label"
                    onChange={(e) => {
                      const val = e.target.value;
                      setDraft((p) => {
                        const km = parseDistanceKm(val, undefined);
                        const elapsedFromClock = computeElapsedHmsFromClockPair(p.gunTime, p.splitPace);
                        const dur = elapsedFromClock || p.chipTime;
                        const nextPace = km > 0 && dur ? computeHighlightPace(dur, km) || p.pace : p.pace;
                        return { ...p, distance: val, pace: nextPace };
                      });
                    }}
                    className="h-10 font-mono text-xs mt-1"
                  />
                )}
              </div>
            </div>

            {/* Timing Telemetry */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label htmlFor="hl-finish-time" className="text-xs font-mono text-[var(--text-secondary)]">
                  Finish Time
                </label>
                <Input
                  id="hl-finish-time"
                  value={draft.chipTime}
                  maxLength={HIGHLIGHT_CAPS.chipTime}
                  disabled={!canManage}
                  placeholder="01:35:32"
                  onChange={(e) => {
                    const val = e.target.value;
                    setDraft((p) => {
                      const km = parseDistanceKm(p.distance, selectedRace || undefined);
                      const nextPace = km > 0 ? computeHighlightPace(val, km) || p.pace : p.pace;
                      return { ...p, chipTime: val, pace: nextPace };
                    });
                  }}
                  className="h-11 font-mono text-sm"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="hl-pace" className="text-xs font-mono text-[var(--text-secondary)]">
                  Pace
                </label>
                <Input
                  id="hl-pace"
                  value={draft.pace}
                  maxLength={HIGHLIGHT_CAPS.pace}
                  disabled={!canManage}
                  placeholder="5:18 /km"
                  onChange={(e) => setDraft((p) => ({ ...p, pace: e.target.value }))}
                  className="h-11 font-mono text-sm"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor={draft.mode === 'duo' ? 'hl-duo-split-1' : 'hl-gun-start'}
                  className="text-xs font-mono text-[var(--text-secondary)]"
                >
                  {draft.mode === 'duo' ? 'Runner 1 Split' : 'Gun Start'}
                </label>
                <Input
                  id={draft.mode === 'duo' ? 'hl-duo-split-1' : 'hl-gun-start'}
                  value={draft.mode === 'duo' ? (draft.soloSplitTime || '') : (draft.gunTime || '')}
                  maxLength={HIGHLIGHT_CAPS.gunTime}
                  disabled={!canManage}
                  placeholder={draft.mode === 'duo' ? '00:41:10' : '05:00:00'}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDraft((p) => {
                      if (draft.mode === 'duo') {
                        return { ...p, soloSplitTime: val };
                      }
                      const elapsed = computeElapsedHmsFromClockPair(val, p.splitPace);
                      if (!elapsed) return { ...p, gunTime: val };
                      const km = parseDistanceKm(p.distance, selectedRace || undefined);
                      const nextPace = km > 0 ? computeHighlightPace(elapsed, km) || p.pace : p.pace;
                      return { ...p, gunTime: val, chipTime: elapsed, pace: nextPace };
                    });
                  }}
                  className="h-11 font-mono text-sm"
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor={draft.mode === 'duo' ? 'hl-duo-split-2' : 'hl-finish-clock'}
                  className="text-xs font-mono text-[var(--text-secondary)]"
                >
                  {draft.mode === 'duo' ? 'Runner 2 Split' : 'Finish'}
                </label>
                <Input
                  id={draft.mode === 'duo' ? 'hl-duo-split-2' : 'hl-finish-clock'}
                  value={draft.mode === 'duo' ? (draft.partnerSplitTime || '') : (draft.splitPace || '')}
                  maxLength={HIGHLIGHT_CAPS.splitPace}
                  disabled={!canManage}
                  placeholder={draft.mode === 'duo' ? '00:43:08' : '06:35:32'}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDraft((p) => {
                      if (draft.mode === 'duo') {
                        return { ...p, partnerSplitTime: val };
                      }
                      const elapsed = computeElapsedHmsFromClockPair(p.gunTime, val);
                      if (!elapsed) return { ...p, splitPace: val };
                      const km = parseDistanceKm(p.distance, selectedRace || undefined);
                      const nextPace = km > 0 ? computeHighlightPace(elapsed, km) || p.pace : p.pace;
                      return { ...p, splitPace: val, chipTime: elapsed, pace: nextPace };
                    });
                  }}
                  className="h-11 font-mono text-sm"
                />
              </div>
            </div>

            {draft.mode === 'duo' && (
              <div className="space-y-1">
                <label className="text-xs font-mono text-[var(--text-secondary)]">Combined Avg Pace</label>
                <Input
                  value={draft.combinedAvgPace || ''}
                  maxLength={HIGHLIGHT_CAPS.pace}
                  disabled={!canManage}
                  placeholder="4:05 /km"
                  onChange={(e) => setDraft((p) => ({ ...p, combinedAvgPace: e.target.value }))}
                  className="h-11 font-mono text-sm"
                />
              </div>
            )}

            {/* Race Event Display Metadata & Club */}
            <div className="space-y-3 pt-2 border-t border-[var(--border-default)]">
              {activeRunner && activeRunner.entries.length > 1 && (
                <div className="space-y-1.5">
                  <span className="block text-[11px] font-mono text-[var(--text-secondary)]">
                    {activeRunner.fullName} Participated Entries
                  </span>
                  <div className="flex flex-wrap gap-2" aria-label={`${activeRunner.fullName} participated races`}>
                    {activeRunner.entries.map((entry) => {
                      const activeChip =
                        matchedActiveEntry?.raceId === entry.raceId &&
                        matchedActiveEntry?.bibNumber === entry.bibNumber;
                      return (
                        <button
                          key={`chip:${entry.raceId}:${entry.bibNumber}`}
                          type="button"
                          disabled={!canManage}
                          onClick={() => applyRunnerRaceEntry(entry, activeRunner)}
                          className={`min-h-10 px-3 py-1.5 rounded-xl border text-xs font-mono transition ${
                            activeChip
                              ? 'bg-red-700 text-white border-red-800 shadow-sm'
                              : 'bg-[var(--surface-inset)] text-[var(--text-secondary)] border-[var(--border-default)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                          }`}
                        >
                          {entry.raceName} · #{entry.bibNumber} ({entry.distance})
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {matchedActiveEntry && !matchedActiveEntry.chipTime && !matchedActiveEntry.splitPace && (
                <p className="text-[11px] font-mono text-[var(--text-secondary)]">
                  Registered bib #{matchedActiveEntry.bibNumber} ({matchedActiveEntry.distance}) loaded; no finish scan recorded for this event yet.
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-xs font-mono text-[var(--text-secondary)]">Race Event Name</label>
                  <Input
                    value={draft.raceName}
                    maxLength={HIGHLIGHT_CAPS.raceName}
                    disabled={!canManage}
                    placeholder="Manila Dawn Half Marathon"
                    onChange={(e) => setDraft((p) => ({ ...p, raceName: e.target.value }))}
                    className="h-11 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-mono text-[var(--text-secondary)]">Date</label>
                  <Input
                    type="date"
                    value={draft.raceDate}
                    disabled={!canManage}
                    onChange={(e) => setDraft((p) => ({ ...p, raceDate: e.target.value }))}
                    className="h-11 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="text-xs font-mono text-[var(--text-secondary)]">Run Club</label>
                  <Input
                    value={draft.runClub || ''}
                    maxLength={HIGHLIGHT_CAPS.runClub}
                    disabled={!canManage}
                    placeholder="BGC Striders"
                    onChange={(e) => setDraft((p) => ({ ...p, runClub: e.target.value }))}
                    className="h-11 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-mono text-[var(--text-secondary)]">HUD Race Code</label>
                  <Input
                    value={draft.raceCode || ''}
                    maxLength={HIGHLIGHT_CAPS.raceCode}
                    disabled={!canManage}
                    placeholder="MNL-21K-26"
                    onChange={(e) => setDraft((p) => ({ ...p, raceCode: e.target.value.toUpperCase() }))}
                    className="h-11 font-mono text-sm uppercase"
                  />
                </div>
              </div>
            </div>
          </section>
            )}

            {composerSection === 'career' && (
              <CareerAchievementsEditor
                draft={draft}
                activeRunner={activeRunner}
                canManage={canManage}
                onUpdateDraft={setDraft}
                onSelectPrimaryEntry={applyRunnerRaceEntry}
              />
            )}

            {/* SECTION 3: Frame, FX & Card Customizer */}
            {composerSection === 'style' && (
              <section className="space-y-4" aria-label="Border, FX and card customizer">
                <div className="flex items-center justify-between gap-2 border-b border-[var(--border-default)] pb-2.5">
                  <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                    Frame, FX &amp; Card Customizer
                  </h2>
                  <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                    {HIGHLIGHT_BORDER_PRESETS.length} borders &bull; {HIGHLIGHT_CARD_EFFECTS.length} FX
                  </span>
                </div>

            {/* Header / Badge Layout */}
            <div className="space-y-1.5">
              <span className="block text-xs font-mono font-semibold text-[var(--text-secondary)]">
                Header &amp; Badge Placement
              </span>
              <div className="grid grid-cols-3 gap-2">
                {HIGHLIGHT_HEADER_STYLES.map((styleOpt) => (
                  <button
                    key={styleOpt.id}
                    type="button"
                    disabled={!canManage}
                    onClick={() => setDraft((p) => ({ ...p, headerStyle: styleOpt.id }))}
                    className={chipBtn((draft.headerStyle || 'crown-bezel') === styleOpt.id)}
                  >
                    <span className="truncate">{styleOpt.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[var(--text-secondary)]">
                {HIGHLIGHT_HEADER_STYLES.find((s) => s.id === (draft.headerStyle || 'crown-bezel'))?.detail}
              </p>
            </div>

            {/* 12 Border & Frame FX Presets */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono font-semibold text-[var(--text-secondary)]">
                  Border &amp; Frame FX Preset
                </span>
                <span className="text-[11px] font-mono text-[var(--text-primary)]">
                  {HIGHLIGHT_BORDER_PRESETS.find((p) => p.id === draft.borderPreset)?.label}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {HIGHLIGHT_BORDER_PRESETS.map((preset) => {
                  const selected = draft.borderPreset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={!canManage}
                      onClick={() => handleSelectBorderPreset(preset.id)}
                      className={`min-h-11 w-full text-left px-3 py-2 rounded-xl border transition ${
                        selected
                          ? 'border-red-600 bg-red-500/12 text-[var(--text-primary)] shadow-sm'
                          : 'border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-xs font-semibold truncate">{preset.label}</span>
                        <span className="inline-flex items-center shrink-0" aria-hidden="true">
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-white/40"
                            style={{ backgroundColor: preset.defaultAccent }}
                          />
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-white/40 -ml-1"
                            style={{ backgroundColor: preset.defaultSecondaryAccent }}
                          />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-[var(--text-secondary)] bg-[var(--surface-inset)] border border-[var(--border-default)] rounded-lg px-2.5 py-1.5">
                {HIGHLIGHT_BORDER_PRESETS.find((p) => p.id === draft.borderPreset)?.summary}
              </p>
            </div>

            {/* Animated Card Effect */}
            <div className="space-y-1.5">
              <span className="block text-xs font-mono font-semibold text-[var(--text-secondary)]">
                Animated Card FX
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {HIGHLIGHT_CARD_EFFECTS.map((fx) => (
                  <button
                    key={fx.id}
                    type="button"
                    disabled={!canManage}
                    onClick={() => setDraft((p) => ({ ...p, cardEffect: fx.id }))}
                    className={chipBtn((draft.cardEffect || 'sheen-sweep') === fx.id)}
                  >
                    <span className="truncate">{fx.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[var(--text-secondary)]">
                {HIGHLIGHT_CARD_EFFECTS.find((fx) => fx.id === (draft.cardEffect || 'sheen-sweep'))?.detail}
              </p>
            </div>

            {/* Corner Geometry (5 Options) */}
            <div className="space-y-1.5">
              <span className="block text-xs font-mono font-semibold text-[var(--text-secondary)]">
                Corner Geometry
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {HIGHLIGHT_CORNER_GEOMETRIES.map((geo) => (
                  <button
                    key={geo.id}
                    type="button"
                    disabled={!canManage}
                    onClick={() => setDraft((p) => ({ ...p, cornerGeometry: geo.id }))}
                    className={chipBtn(draft.cornerGeometry === geo.id)}
                  >
                    <span className="truncate">{geo.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[var(--text-secondary)]">
                {HIGHLIGHT_CORNER_GEOMETRIES.find((g) => g.id === draft.cornerGeometry)?.detail}
              </p>
            </div>

            {/* Dual Accent Color, Border Thickness, Glow & Scrim Contrast */}
            <div className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="hl-accent-hex" className="text-xs font-mono font-semibold text-[var(--text-primary)]">
                  Primary Accent Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="hl-accent-picker"
                    type="color"
                    disabled={!canManage}
                    aria-label="Pick primary accent color"
                    value={draft.accentColor}
                    onChange={(e) => setDraft((p) => ({ ...p, accentColor: e.target.value }))}
                    className="w-9 h-9 rounded-lg border border-[var(--border-default)] bg-transparent cursor-pointer"
                  />
                  <Input
                    id="hl-accent-hex"
                    value={draft.accentColor}
                    disabled={!canManage}
                    maxLength={7}
                    onChange={(e) => setDraft((p) => ({ ...p, accentColor: e.target.value }))}
                    className="w-24 h-9 font-mono text-xs uppercase"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {QUICK_ACCENT_SWATCHES.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    disabled={!canManage}
                    aria-label={`Select primary accent ${hex}`}
                    onClick={() => setDraft((p) => ({ ...p, accentColor: hex }))}
                    className={`w-8 h-8 rounded-full border-2 transition ${
                      draft.accentColor.toLowerCase() === hex ? 'border-white scale-110 ring-2 ring-red-600' : 'border-black/30'
                    }`}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between gap-3 pt-1 border-t border-[var(--border-default)]">
                <label htmlFor="hl-secondary-accent-hex" className="text-xs font-mono font-semibold text-[var(--text-primary)]">
                  Secondary Trim Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="hl-secondary-accent-picker"
                    type="color"
                    disabled={!canManage}
                    aria-label="Pick secondary accent color"
                    value={draft.secondaryAccentColor || '#ff3b30'}
                    onChange={(e) => setDraft((p) => ({ ...p, secondaryAccentColor: e.target.value }))}
                    className="w-9 h-9 rounded-lg border border-[var(--border-default)] bg-transparent cursor-pointer"
                  />
                  <Input
                    id="hl-secondary-accent-hex"
                    value={draft.secondaryAccentColor || '#ff3b30'}
                    disabled={!canManage}
                    maxLength={7}
                    onChange={(e) => setDraft((p) => ({ ...p, secondaryAccentColor: e.target.value }))}
                    className="w-24 h-9 font-mono text-xs uppercase"
                  />
                </div>
              </div>

              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-[var(--text-secondary)]">Border Thickness</span>
                  <span className="font-semibold text-[var(--text-primary)]">{draft.borderWidthPx ?? 3}px</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={6}
                  step={1}
                  disabled={!canManage}
                  aria-label="Border thickness in pixels"
                  value={draft.borderWidthPx ?? 3}
                  onChange={(e) => setDraft((p) => ({ ...p, borderWidthPx: Number(e.target.value) }))}
                  className="w-full accent-red-600 cursor-pointer"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-[var(--text-secondary)]">Glow Intensity</span>
                  <span className="font-semibold text-[var(--text-primary)]">{draft.glowIntensity}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  disabled={!canManage}
                  aria-label="Glow intensity"
                  value={draft.glowIntensity}
                  onChange={(e) => setDraft((p) => ({ ...p, glowIntensity: Number(e.target.value) }))}
                  className="w-full accent-red-600 cursor-pointer"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-[var(--text-secondary)]">Photo Scrim Contrast</span>
                  <span className="font-semibold text-[var(--text-primary)]">{draft.scrimStrength ?? 78}%</span>
                </div>
                <input
                  type="range"
                  min={30}
                  max={95}
                  disabled={!canManage}
                  aria-label="Photo scrim contrast percentage"
                  value={draft.scrimStrength ?? 78}
                  onChange={(e) => setDraft((p) => ({ ...p, scrimStrength: Number(e.target.value) }))}
                  className="w-full accent-red-600 cursor-pointer"
                />
              </div>
            </div>

            {/* Surface Finish (5 Options) */}
            <div className="space-y-2">
              <span className="block text-xs font-mono font-semibold text-[var(--text-secondary)]">
                Surface Finish
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {HIGHLIGHT_SURFACE_FINISHES.map((finish) => (
                  <button
                    key={finish.id}
                    type="button"
                    disabled={!canManage}
                    onClick={() => setDraft((p) => ({ ...p, surfaceFinish: finish.id }))}
                    className={chipBtn(draft.surfaceFinish === finish.id)}
                  >
                    <span className="truncate">{finish.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Badge Stamp */}
            <div className="space-y-2">
              <label htmlFor="hl-stamp" className="block text-xs font-mono font-semibold text-[var(--text-secondary)]">
                Custom Badge Stamp (Optional)
              </label>
              <Input
                id="hl-stamp"
                value={draft.badgeStamp || ''}
                maxLength={HIGHLIGHT_CAPS.badgeStamp}
                disabled={!canManage}
                placeholder="e.g. NEW COURSE RECORD"
                onChange={(e) => setDraft((p) => ({ ...p, badgeStamp: e.target.value }))}
                className="h-11 font-mono text-xs uppercase"
              />
              <div className="flex flex-wrap gap-1.5">
                {QUICK_BADGE_STAMPS.map((stamp) => (
                  <button
                    key={stamp}
                    type="button"
                    disabled={!canManage}
                    onClick={() => setDraft((p) => ({ ...p, badgeStamp: stamp }))}
                    className="min-h-8 px-2.5 py-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-[11px] font-mono text-[var(--text-primary)]"
                  >
                    {stamp}
                  </button>
                ))}
                {draft.badgeStamp && (
                  <button
                    type="button"
                    disabled={!canManage}
                    onClick={() => setDraft((p) => ({ ...p, badgeStamp: '' }))}
                    className="min-h-8 px-2.5 py-1 rounded-lg border border-[var(--border-default)] text-[11px] font-mono text-red-700 dark:text-red-400"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </section>
            )}

            {/* Stepped Composer Footer Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[var(--border-default)]">
              <div className="text-[11px] font-mono text-[var(--text-secondary)]">
                {composerSection === 'athlete' && 'Step 1 of 3: Select event, finisher, and timing'}
                {composerSection === 'career' && 'Step 2 of 3: Attach achievements & participated races'}
                {composerSection === 'style' && 'Step 3 of 3: Customize border preset, accents & finish'}
              </div>
              <div className="flex items-center gap-2">
                {composerSection !== 'athlete' && (
                  <button
                    type="button"
                    onClick={() =>
                      setComposerSection(composerSection === 'style' ? 'career' : 'athlete')
                    }
                    className={chipBtn(false)}
                  >
                    <span>Back</span>
                  </button>
                )}
                {composerSection !== 'style' && (
                  <button
                    type="button"
                    onClick={() =>
                      setComposerSection(composerSection === 'athlete' ? 'career' : 'style')
                    }
                    className={chipBtn(true)}
                  >
                    <span>
                      {composerSection === 'athlete'
                        ? 'Next: Events & Achievements'
                        : 'Next: Frame & Visual FX'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT STICKY STAGE: Interactive Live Preview, Career Synergy & Publishing */}
          <section
            className="xl:col-span-4 xl:sticky xl:top-20 glass-panel p-4 sm:p-5 space-y-4"
            aria-label="Interactive live preview"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-default)] pb-2.5">
              <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                Live Stage
              </h2>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPreviewHover((v) => !v)}
                  className={chipBtn(previewHover)}
                >
                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{previewHover ? 'Spotlight' : 'Cruise'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewLayout((m) => (m === 'card' ? 'pill' : 'card'))}
                  className={chipBtn(previewLayout === 'pill')}
                >
                  <span>{previewLayout === 'pill' ? 'Pill' : 'Card'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDossierItem(livePreviewItem)}
                  className={chipBtn(false)}
                  title="Open interactive Finisher Dossier view with all achievements and events"
                >
                  <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Dossier</span>
                </button>
              </div>
            </div>

            {/* Preview Stage */}
            <div className="rounded-2xl border border-[var(--border-default)] bg-zinc-950/95 p-4 flex items-center justify-center overflow-x-auto min-h-[388px]">
              <PodiumPulseCard
                highlight={livePreviewItem}
                layoutMode={previewLayout}
                isSpotlight={previewHover}
                onSelect={() => setDossierItem(livePreviewItem)}
              />
            </div>

            {/* Single-Card Career & Placement Summary */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                <span className="px-2 py-0.5 rounded bg-red-700/15 text-red-700 dark:text-red-300 font-semibold">
                  {livePreviewItem.placement || 'Finisher'}
                </span>
                <span className="px-2 py-0.5 rounded border border-[var(--border-default)] text-[var(--text-secondary)] inline-flex items-center gap-1">
                  <CalendarDays className="w-3 h-3" aria-hidden="true" />
                  {(draft.participatedEvents || []).length || (draft.raceName ? 1 : 0)} events
                </span>
                <span className="px-2 py-0.5 rounded border border-[var(--border-default)] text-[var(--text-secondary)] inline-flex items-center gap-1">
                  <Trophy className="w-3 h-3" aria-hidden="true" />
                  {(draft.achievements || []).length} badges
                </span>
              </div>
              <button
                type="button"
                onClick={() => setComposerSection('career')}
                className="text-xs font-semibold text-red-700 dark:text-red-400 hover:underline min-h-9 px-2"
              >
                Edit career
              </button>
            </div>

            {/* Pin & Expiration Schedule */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5 space-y-3">
              <label className="flex items-center justify-between gap-3 cursor-pointer min-h-10">
                <span className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <Flame className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                  <span>Pin highlight to front of reel</span>
                </span>
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={Boolean(draft.pinned)}
                  onChange={(e) => setDraft((p) => ({ ...p, pinned: e.target.checked }))}
                  className="w-5 h-5 accent-red-600 rounded"
                />
              </label>

              <div className="flex items-center justify-between gap-3">
                <label htmlFor="hl-expires" className="text-xs font-mono text-[var(--text-secondary)]">
                  Auto-expire after
                </label>
                <Input
                  id="hl-expires"
                  type="date"
                  disabled={!canManage}
                  value={draft.expiresAt || ''}
                  onChange={(e) => setDraft((p) => ({ ...p, expiresAt: e.target.value }))}
                  className="w-44 h-10 font-mono text-xs"
                />
              </div>
            </div>

            {/* Publish / Reset Buttons */}
            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
              <Button type="submit" disabled={!canManage || savingHighlight} className="h-11 px-4 flex-1 text-xs">
                {editingId ? <Save className="w-4 h-4" aria-hidden="true" /> : <Plus className="w-4 h-4" aria-hidden="true" />}
                <span>
                  {savingHighlight
                    ? 'Saving...'
                    : editingId
                      ? 'Save Highlight Changes'
                      : 'Publish Highlight'}
                </span>
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={savingHighlight}
                onClick={() => {
                  setEditingId(null);
                  setSelectedRunnerKey(null);
                  setRunnerDropdownOpen(false);
                  setPartnerDropdownOpen(false);
                  setStudioDistanceFilter('all');
                  setComposerSection('athlete');
                  setDraft(createBlankDraft(profile.uid));
                }}
                className="h-11 px-4 text-xs"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{editingId ? 'Cancel edit' : 'Reset'}</span>
              </Button>
            </div>
          </section>
        </form>
      )}

      {/* TAB 2: PUBLISHED HIGHLIGHTS MANAGER */}
      {subTab === 'published' && (
        <PublishedHighlightsManager
          highlights={highlights}
          orderedHighlights={orderedHighlights}
          races={races}
          canManage={canManage}
          onCreateNew={() => {
            setEditingId(null);
            setComposerSection('athlete');
            setSubTab('studio');
          }}
          onEdit={handleEditHighlight}
          onDuplicate={handleDuplicateHighlight}
          onTogglePin={handleTogglePin}
          onDelete={handleDeleteHighlight}
          onPreviewDossier={setDossierItem}
        />
      )}

      {/* TAB 3: GLOBAL MARQUEE CONTROL DECK */}
      {subTab === 'deck' && (
        <MarqueeControlDeck
          config={config}
          races={races}
          canSettings={canSettings}
          canPlaylist={canPlaylist}
          savingConfig={savingConfig}
          onChangeConfig={setConfig}
          onSaveDeck={handleSaveDeck}
        />
      )}

      {/* LANDING PAGE LIVE PREVIEW */}
      <section
        data-testid="highlights-landing-preview"
        aria-label="Landing page highlights preview"
        className="glass-panel p-4 sm:p-5 space-y-4 min-w-0 overflow-hidden"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-[var(--border-default)] pb-3">
          <div className="min-w-0">
            <h2 className="font-display text-base sm:text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Globe className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
              <span>Landing Page Preview</span>
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Live simulation of how the finisher lookup bar and scrolling podium highlights appear together on the public landing page.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className="px-2.5 py-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-mono text-[var(--text-secondary)]">
              {config.speedPxPerSec} px/sec
            </span>
            <span className="px-2.5 py-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-mono text-[var(--text-secondary)]">
              {config.direction === 'left' ? 'Left flow' : 'Right flow'}
            </span>
            <span className="px-2.5 py-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-mono text-[var(--text-secondary)]">
              {config.layoutMode === 'pill' ? 'Pill (360x140)' : 'Card (260x340)'}
            </span>
            <button
              type="button"
              aria-pressed={includeDraftInLandingPreview}
              onClick={() => setIncludeDraftInLandingPreview((prev) => !prev)}
              className={chipBtn(includeDraftInLandingPreview)}
            >
              <span>Include Draft Card</span>
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-page)] p-4 sm:p-5 space-y-5 min-w-0 overflow-hidden">
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-sm sm:text-base font-semibold text-[var(--text-primary)]">
                Already crossed the line?
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Find your finish time and finisher certificate. Focus the search field to test Ambient Mode dimming.
              </p>
            </div>
            <div className="relative w-full md:w-80 shrink-0">
              <Search
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none"
                aria-hidden="true"
              />
              <label htmlFor="hl-landing-preview-search" className="sr-only">
                Simulated landing page finisher lookup search
              </label>
              <Input
                id="hl-landing-preview-search"
                type="search"
                value={landingPreviewSearch}
                onFocus={() => setLandingPreviewSearchFocused(true)}
                onBlur={() => setLandingPreviewSearchFocused(false)}
                onChange={(e) => setLandingPreviewSearch(e.target.value)}
                placeholder="Bib or name (focus to dim marquee)"
                className={`h-11 pl-9 ${landingPreviewSearch ? 'pr-11' : 'pr-3'} text-xs sm:text-sm [&::-webkit-search-cancel-button]:hidden`}
              />
              {landingPreviewSearch && (
                <button
                  type="button"
                  onClick={() => setLandingPreviewSearch('')}
                  aria-label="Clear preview search"
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          <PodiumPulseReel
            instanceId="studio-preview"
            searchFocused={landingPreviewSearchFocused || landingPreviewSearch.trim().length > 0}
            overrideHighlights={landingPreviewHighlights}
            overrideConfig={config}
          />
        </div>
      </section>

      {cropSession && (
        <HighlightSmartCropModal
          sourceUrl={cropSession.sourceUrl}
          label={
            cropSession.target.kind === 'partner'
              ? 'Runner 2 photo'
              : cropSession.target.kind === 'group-member'
                ? `Group member ${cropSession.target.index + 1} photo`
                : draft.mode === 'group'
                  ? 'Group photo'
                  : 'Runner 1 photo'
          }
          aspectRatio={
            draft.mode === 'duo'
              ? 0.48
              : cropSession.target.kind === 'group-member'
                ? 0.72
                : 260 / 340
          }
          targetWidth={draft.mode === 'duo' ? 320 : cropSession.target.kind === 'group-member' ? 400 : 520}
          targetHeight={680}
          onCancel={() => setCropSession(null)}
          onConfirm={(croppedUrl) => {
            applyPhotoToSlot(cropSession.target, croppedUrl);
            setCropSession(null);
          }}
        />
      )}

      {accountPickerTarget && (
        <DialogSurface
          titleId="hl-account-picker-title"
          descriptionId="hl-account-picker-desc"
          onRequestClose={() => setAccountPickerTarget(null)}
          initialFocusRef={accountSearchInputRef as React.RefObject<HTMLElement>}
          className="m-auto w-[min(94vw,520px)] max-h-[85vh] overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] p-0 shadow-2xl flex flex-col"
        >
          <div className="p-4 sm:p-5 border-b border-[var(--border-default)] flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-mono uppercase tracking-wider text-red-700 dark:text-red-400 font-semibold">
                Runner Profile Picture
              </p>
              <h3 id="hl-account-picker-title" className="font-display text-lg font-semibold text-[var(--text-primary)] mt-0.5">
                Attach Runner Account Photo
              </h3>
              <p id="hl-account-picker-desc" className="text-xs text-[var(--text-secondary)] mt-1">
                {accountPickerTarget.kind === 'partner'
                  ? 'Select a registered account avatar for Runner 2.'
                  : accountPickerTarget.kind === 'group-member'
                    ? `Select a registered account avatar for Group Member ${accountPickerTarget.index + 1}.`
                    : 'Select a registered runner account avatar to attach directly.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAccountPickerTarget(null)}
              aria-label="Close account photo picker"
              className="min-h-11 min-w-11 shrink-0 rounded-full border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] flex items-center justify-center text-[var(--text-primary)]"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <div className="p-4 border-b border-[var(--border-default)]">
            <search>
              <label htmlFor="hl-account-search" className="sr-only">
                Search runner accounts by name or username
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-[var(--text-secondary)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
                <Input
                  ref={accountSearchInputRef}
                  id="hl-account-search"
                  value={accountSearch}
                  placeholder="Search runner name, nickname, or @username..."
                  onChange={(e) => setAccountSearch(e.target.value)}
                  className="h-11 pl-10 pr-10 text-sm"
                />
                {accountSearch && (
                  <button
                    type="button"
                    aria-label="Clear account search"
                    onClick={() => setAccountSearch('')}
                    className="min-h-11 min-w-11 absolute right-0 top-1/2 -translate-y-1/2 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </search>
          </div>

          <div className="p-3 overflow-y-auto flex-1 space-y-1.5">
            {filteredAccountChoices.length === 0 ? (
              <p className="py-8 text-center text-xs font-mono text-[var(--text-secondary)]">
                {availableAccounts.length === 0
                  ? 'No runner accounts with profile photos found yet.'
                  : `No accounts match "${accountSearch.trim()}".`}
              </p>
            ) : (
              filteredAccountChoices.map((acc) => (
                <button
                  key={acc.uid}
                  type="button"
                  onClick={() => {
                    applyPhotoToSlot(accountPickerTarget, acc.photoURL, acc);
                    setAccountPickerTarget(null);
                  }}
                  className="w-full min-h-14 px-3 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] flex items-center gap-3 text-left transition"
                >
                  <img
                    src={acc.photoURL}
                    alt={acc.displayName}
                    className="w-10 h-10 rounded-full object-cover border border-[var(--border-default)] shrink-0 bg-zinc-900"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                      {acc.displayName}
                    </p>
                    <p className="text-[11px] font-mono text-[var(--text-secondary)] truncate">
                      {acc.username ? `@${acc.username}` : acc.nickname || acc.uid}
                    </p>
                  </div>
                  <span className="shrink-0 px-2.5 py-1 rounded-lg bg-red-700 text-white text-[11px] font-mono font-semibold">
                    Attach
                  </span>
                </button>
              ))
            )}
          </div>
        </DialogSurface>
      )}

      {dossierItem && (
        <FinisherDossierModal
          highlight={dossierItem}
          onClose={() => setDossierItem(null)}
        />
      )}
    </div>
  );
}
