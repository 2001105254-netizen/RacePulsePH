import { formatClockTime, formatRaceTime } from '../lib/preciseTime';
import { useAccess } from '../lib/access';
import { subscribeSharedRaces } from '../lib/racesStore';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, doc, getDoc, getDocs, onSnapshot, query, runTransaction, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db, signOutUser } from '../firebase';
import AccountPrivacyModal from './AccountPrivacyModal';
import { checkpointType, computeResults, getWaveStartTime } from '../lib/timing';
import { downloadFinisherCertificate } from '../lib/finisherCertificate';
import { ChipRead, FriendActivity, FriendProfile, Gender, PublicLeaderboardEntry, PublicLiveResults, Race, RaceEntryCategory, RunnerProfile, UserProfile } from '../types';
import type { LegalDocKey } from '../lib/legalConfig';
import DialogSurface from './ui/DialogSurface';
import CustomerForm, { type EngravingRacePrefill } from './CustomerForm';
import RaceTimeText from './ui/RaceTimeText';
import { QRCodeSVG } from 'qrcode.react';
import { LogOut, User, Hash, MapPin, RefreshCw, Award, ClipboardList, Clock, ArrowLeft, ArrowRight, Flag, Calendar, CheckSquare, Coins, PackageCheck, Camera, Search, Trophy, X, CheckCircle2, Circle, Radio, Phone, HeartPulse, Mail, FileDown, Maximize2, Users2, UserPlus, UserCheck, AlertTriangle, ShieldCheck } from 'lucide-react';
import WorkspaceShell from './WorkspaceShell';
import type { WorkspaceSwitchProps } from './DesktopSidebar';
import RaceList from './RaceList';
import { isRaceRegistrationOpen } from '../lib/raceRegistration';
import { entryCategoryLabels, entryMemberCount, raceEntryCategories, runnerDivisionLabel, runnerEntryCategory } from '../lib/raceEntry';
import { raceBibNameLines, resolveRaceBibTemplate } from '../lib/raceBib';
import { ensureRaceBibCustomFont, raceBibFontFamily } from '../lib/raceBibFont';
import RunnerReminderCenter from './RunnerReminderCenter';
import { createPayMongoCheckout, getPaymentStatus, PaymentStatusResponse } from '../lib/payments';
import QrScannerModal from './QrScannerModal';
import PublicRaceResults from './PublicRaceResults';
import { useAndroidBackHandler } from '../lib/capacitorAndroid';
import { claimRaceBib, claimableEntryLabel, parseRaceBibQr, previewRaceBibClaim, RaceBibClaimPreview } from '../lib/raceBibClaim';
import { AnimatedMetricValue, AnimatedTabView, ViewLoadingSkeleton, resolveTabDirection, type NavDirection } from './ui/MotionPrimitives';
import { useWorkspaceHeader } from '../lib/workspaceHeader';
import RouteMap3D from './RouteMap3D';

interface RunnerDashboardProps {
  profile: UserProfile;
  initialRaceId?: string | null;
  onInitialRaceHandled?: () => void;
  workspaceSwitch?: WorkspaceSwitchProps;
  pendingApprovalNotice?: boolean;
}

type RunnerTab = 'events' | 'allraces' | 'myraces' | 'friends' | 'engraving';

const RUNNER_TAB_ORDER: readonly RunnerTab[] = ['events', 'allraces', 'myraces', 'friends', 'engraving'];

const standardShirtSizes = ['2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];
const usernamePattern = /^[a-z0-9][a-z0-9_.-]{2,23}$/;

function normalizedUsername(value: string): string {
  return value.trim().toLowerCase();
}

function ShirtSizePicker({ value, onChange, emptyLabel }: { value: string; onChange: (value: string) => void; emptyLabel: string }) {
  const { can, authority } = useAccess();
  const [customMode, setCustomMode] = useState(() => Boolean(value && !standardShirtSizes.includes(value)));
  const usesCustomSize = customMode || Boolean(value && !standardShirtSizes.includes(value));
  return (
    <div className="space-y-2">
      <select
        value={usesCustomSize ? '__other__' : value}
        onChange={(e) => {
          if (e.target.value === '__other__') {
            setCustomMode(true);
            onChange('');
          } else {
            setCustomMode(false);
            onChange(e.target.value);
          }
        }}
        className="w-full appearance-none glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
      >
        <option value="">{emptyLabel}</option>
        {standardShirtSizes.map((size) => <option key={size} value={size}>{size}</option>)}
        <option value="__other__">Other size (type it below)</option>
      </select>
      {usesCustomSize && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          maxLength={20}
          placeholder="EX: 7XL, 3XS, CUSTOM"
          className="w-full glass-inset px-4 py-3 text-sm font-semibold uppercase text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
        />
      )}
    </div>
  );
}

function loadDirectImage(source: string, useCors: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (useCors && !source.startsWith('data:') && !source.startsWith('blob:')) {
      image.crossOrigin = 'anonymous';
    }
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load the race bib template.'));
    image.src = source;
  });
}

async function loadDataImage(source: string): Promise<HTMLImageElement> {
  try {
    return await loadDirectImage(source, true);
  } catch {
    if (source.startsWith('data:') || source.startsWith('blob:')) {
      throw new Error('Unable to load the race bib template.');
    }
    const response = await fetch(source, { mode: 'cors', cache: 'reload' });
    if (!response.ok) {
      throw new Error('Unable to load the race bib template.');
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      return await loadDirectImage(objectUrl, false);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

// The download is drawn directly onto the original bib artwork rather than
// screenshotting the responsive preview. This keeps the output crisp and
// makes long names shrink-to-fit instead of being cropped on a phone screen.
function drawFittedRaceBibText(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
  xPercent: number,
  yPercent: number,
  sizePercent: number,
  color: string,
  strokeColor: string,
  strokeWidthPercent: number,
  fontFamily: string,
): void {
  let fontSize = Math.max(12, (width * sizePercent) / 100);
  const maxWidth = width * 0.9;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  do {
    ctx.font = `900 ${fontSize}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth || fontSize <= 12) break;
    fontSize -= 1;
  } while (fontSize > 12);

  const x = Math.min(width * 0.95, Math.max(width * 0.05, (width * xPercent) / 100));
  const safeHalfHeight = fontSize * 0.62;
  const y = Math.min(height - safeHalfHeight - 6, Math.max(safeHalfHeight + 6, (height * yPercent) / 100));
  const strokeWidth = Math.max(0, (width * strokeWidthPercent) / 100);
  if (strokeWidth > 0) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = strokeWidth * 2;
    ctx.strokeStyle = strokeColor;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = Math.max(1.5, fontSize * 0.035);
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.max(1, fontSize * 0.025);
  ctx.fillText(text, x, y);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function drawFittedRaceBibTextLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  width: number,
  height: number,
  xPercent: number,
  yPercent: number,
  sizePercent: number,
  color: string,
  strokeColor: string,
  strokeWidthPercent: number,
  fontFamily: string,
): void {
  if (lines.length <= 1) {
    drawFittedRaceBibText(ctx, lines[0] || '', width, height, xPercent, yPercent, sizePercent, color, strokeColor, strokeWidthPercent, fontFamily);
    return;
  }

  const maxWidth = width * 0.9;
  // Keep multi-member team names above lower bib artwork such as inclusions
  // and medal panels.
  const maxBlockHeight = height * 0.18;
  let fontSize = Math.max(12, Math.min((width * sizePercent) / 100, maxBlockHeight / (lines.length * 1.16)));
  do {
    ctx.font = `900 ${fontSize}px ${fontFamily}`;
    if (lines.every((line) => ctx.measureText(line).width <= maxWidth) || fontSize <= 12) break;
    fontSize -= 1;
  } while (fontSize > 12);

  const x = Math.min(width * 0.95, Math.max(width * 0.05, (width * xPercent) / 100));
  const lineHeight = fontSize * 1.16;
  const blockHalfHeight = (lineHeight * (lines.length - 1)) / 2 + fontSize * 0.62;
  const centerY = Math.min(height - blockHalfHeight - 6, Math.max(blockHalfHeight + 6, (height * yPercent) / 100));
  const firstY = centerY - (lineHeight * (lines.length - 1)) / 2;
  const strokeWidth = Math.max(0, (width * strokeWidthPercent) / 100);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = Math.max(1.5, fontSize * 0.035);
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.max(1, fontSize * 0.025);
  if (strokeWidth > 0) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = strokeWidth * 2;
    ctx.strokeStyle = strokeColor;
  }
  for (const [index, line] of lines.entries()) {
    const y = firstY + lineHeight * index;
    if (strokeWidth > 0) ctx.strokeText(line, x, y);
    ctx.fillText(line, x, y);
  }
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function philippineTodayStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
}

function drawFallbackRaceBibCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  race: Race,
  runnerProfile: RunnerProfile,
): void {
  // High-contrast dark editorial RacePulsePH bib canvas used if remote bib artwork is blocked by cross-origin headers.
  ctx.fillStyle = '#141418';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#991b1b';
  ctx.fillRect(0, 0, width, Math.round(height * 0.14));

  ctx.strokeStyle = '#3f3f46';
  ctx.lineWidth = 6;
  ctx.strokeRect(12, 12, width - 24, height - 24);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 28px system-ui, sans-serif';
  ctx.fillText((race.name || 'RACEPULSE PH').toUpperCase(), 38, Math.round(height * 0.07));

  ctx.textAlign = 'right';
  ctx.fillStyle = '#fca5a5';
  ctx.font = '700 24px monospace';
  ctx.fillText(runnerProfile.distance || '', width - 38, Math.round(height * 0.07));

  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, Math.round(height * 0.91), width, Math.round(height * 0.09));
  ctx.textAlign = 'center';
  ctx.fillStyle = '#d4d4d8';
  ctx.font = '600 18px system-ui, sans-serif';
  ctx.fillText('RACEPULSE PH OFFICIAL DIGITAL RACE BIB', width / 2, Math.round(height * 0.955));
}

function mostRecent(profiles: RunnerProfile[]): RunnerProfile | undefined {
  return [...profiles].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

export default function RunnerDashboard({ profile, initialRaceId, onInitialRaceHandled, workspaceSwitch, pendingApprovalNotice }: RunnerDashboardProps) {
  const { can, authority } = useAccess();
  const headerCtx = useWorkspaceHeader();
  const [isDesktop, setIsDesktop] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true));
  const [runnerProfiles, setRunnerProfiles] = useState<RunnerProfile[] | undefined>(undefined); // undefined = loading
  const [sharedRaces, setSharedRaces] = useState<Race[]>([]);
  const [friendsCount, setFriendsCount] = useState(0);
  const homeTab: RunnerTab = can('personal.register') ? 'events' : can('personal.results') || can('personal.bibs') ? 'myraces' : can('personal.friends') ? 'friends' : 'engraving';
  const [tab, setTab] = useState<RunnerTab>(homeTab);
  const [tabDirection, setTabDirection] = useState<NavDirection>('forward');
  const [showProfile, setShowProfile] = useState(false);
  const [showEventQrScanner, setShowEventQrScanner] = useState(false);
  const [scannedRaceId, setScannedRaceId] = useState<string | null>(null);
  const [pendingDeepLinkRaceId, setPendingDeepLinkRaceId] = useState<string | null>(() => initialRaceId || null);
  const [eventQrMessage, setEventQrMessage] = useState('');
  const [eventQrError, setEventQrError] = useState('');
  const [pendingBibClaim, setPendingBibClaim] = useState<(RaceBibClaimPreview & { payload: { raceId: string; bibNumber: string } }) | null>(null);
  const [claimingBib, setClaimingBib] = useState(false);
  const [bibClaimError, setBibClaimError] = useState('');
  const tabRef = useRef<RunnerTab>(tab);
  tabRef.current = tab;
  const homeTabRef = useRef<RunnerTab>(homeTab);
  homeTabRef.current = homeTab;
  const showProfileRef = useRef(showProfile);
  showProfileRef.current = showProfile;

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    return subscribeSharedRaces((rawList, loaded, err) => {
      if (err) {
        console.warn('Runner portal races listener failed:', err);
        return;
      }
      if (loaded) setSharedRaces(rawList);
    });
  }, []);

  useEffect(() => {
    if (!can('personal.friends')) {
      setFriendsCount(0);
      return;
    }
    return onSnapshot(
      query(collection(db, 'friendships'), where('members', 'array-contains', profile.uid)),
      (snapshot) => setFriendsCount(snapshot.size),
      () => setFriendsCount(0),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.uid]);

  const selectTab = (nextTab: RunnerTab, explicitDirection?: NavDirection) => {
    const currentTab = tabRef.current;
    if (nextTab === currentTab) return;
    setTabDirection(explicitDirection ?? resolveTabDirection(RUNNER_TAB_ORDER, currentTab, nextTab));
    setTab(nextTab);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  };

  useAndroidBackHandler(showProfile, () => setShowProfile(false));
  useAndroidBackHandler(Boolean(pendingBibClaim), () => {
    if (!claimingBib) setPendingBibClaim(null);
  });

  useEffect(() => {
    const goHome = (event: Event) => {
      const hardware = event instanceof CustomEvent && Boolean(event.detail?.hardware);
      if (hardware) {
        if (event.defaultPrevented || (tabRef.current === homeTabRef.current && !showProfileRef.current)) return;
        event.preventDefault();
      }
      setShowProfile(false);
      selectTab(hardware ? homeTabRef.current : 'events', 'back');
    };
    window.addEventListener('racepulse:back', goHome);
    return () => window.removeEventListener('racepulse:back', goHome);
  }, []);

  useEffect(() => {
    if (!initialRaceId) return;
    setPendingDeepLinkRaceId(initialRaceId);
    setTab('events');
    onInitialRaceHandled?.();
  }, [initialRaceId, onInitialRaceHandled]);

  useEffect(() => {
    if (!['personal.register','personal.results','personal.bibs','personal.certificates'].some(can)) { setRunnerProfiles([]); return; }
    let directProfiles: RunnerProfile[] = [];
    let claimedProfiles: RunnerProfile[] = [];
    const publish = () => {
      // A normal in-app registration always wins over a QR claim for the
      // same event. QR claims are for Google Form/imported rosters, where the
      // registration was made before the runner had a RacePulse account.
      const directRaceIds = new Set(directProfiles.map((item) => item.raceId));
      setRunnerProfiles([...directProfiles, ...claimedProfiles.filter((item) => !directRaceIds.has(item.raceId))]);
    };
    const unsubscribeProfiles = onSnapshot(query(collection(db, 'runners'), where('uid', '==', profile.uid)), (snapshot) => {
      directProfiles = snapshot.docs.map((docSnap) => docSnap.data() as RunnerProfile);
      publish();
    }, (err) => {
      console.warn('Runner profiles listener failed:', err.message);
      directProfiles = [];
      publish();
    });
    const unsubscribeClaims = onSnapshot(query(collection(db, 'runnerClaims'), where('uid', '==', profile.uid)), (snapshot) => {
      claimedProfiles = snapshot.docs
        .map((docSnap) => docSnap.data()?.runner as RunnerProfile | undefined)
        .filter((runner): runner is RunnerProfile => Boolean(runner));
      publish();
    }, (err) => {
      // Older deployments have no runnerClaims rule yet. The normal runner
      // list still works while the rules/function deployment is completed.
      console.warn('Runner bib claims listener failed:', err.message);
      claimedProfiles = [];
      publish();
    });
    return () => { unsubscribeProfiles(); unsubscribeClaims(); };
  }, [profile.uid]);

  // Legacy accounts get their safe friend card automatically once they open
  // the Runner Portal. No email or private medical/payment fields are copied.
  useEffect(() => {
    const username = profile.username?.trim().toLowerCase();
    if (!username) return;
    const payload = {
      uid: profile.uid,
      username,
      displayName: profile.displayName,
      ...(profile.nickname ? { nickname: profile.nickname } : {}),
      ...(profile.photoURL ? { photoURL: profile.photoURL } : {}),
      updatedAt: new Date().toISOString(),
    };
    void Promise.all([
      setDoc(doc(db, 'friendDirectory', username), payload, { merge: true }),
      setDoc(doc(db, 'friendProfiles', profile.uid), payload, { merge: true }),
    ]).catch((err) => console.warn('Failed to update friend profile:', err));
  }, [profile.uid, profile.username, profile.displayName, profile.nickname, profile.photoURL]);

  // Publish only a short race summary for accepted friends. Raw registrations,
  // bibs, results, payment state, and medical/emergency data stay private.
  useEffect(() => {
    if (!runnerProfiles) return;
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await getDocs(collection(db, 'races'));
        if (cancelled) return;
        const raceById = new Map<string, Race>();
        snapshot.forEach((item) => raceById.set(item.id, item.data() as Race));
        const recentRaces = [...runnerProfiles]
          .map((runner) => {
            const race = raceById.get(runner.raceId);
            return race ? { raceId: race.id, raceName: race.name, date: race.date, distance: runner.distance } : null;
          })
          .filter((item): item is NonNullable<typeof item> => item !== null)
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 6);
        await setDoc(doc(db, 'friendActivities', profile.uid), {
          uid: profile.uid,
          recentRaces,
          updatedAt: new Date().toISOString(),
        } satisfies FriendActivity);
      } catch (err) {
        console.warn('Failed to update friend activity:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [profile.uid, runnerProfiles]);

  const latestProfile = runnerProfiles ? mostRecent(runnerProfiles) : undefined;

  const scanEventQr = async (text: string): Promise<boolean> => {
    const bibPayload = parseRaceBibQr(text);
    if (bibPayload) {
      try {
        setEventQrError('');
        setEventQrMessage('Checking your race bib…');
        const preview = await previewRaceBibClaim(bibPayload);
        setPendingBibClaim({ ...preview, payload: bibPayload });
        setEventQrMessage(preview.alreadyLinked ? 'This race is already in My Races.' : 'Race bib found: review the details to add it.');
        window.setTimeout(() => setShowEventQrScanner(false), 300);
        return true;
      } catch (error: any) {
        setEventQrError(error.message || 'We could not find a runner for this race bib QR code.');
        return false;
      }
    }
    try {
      const url = new URL(text.trim());
      const allowedHosts = new Set(['racepulseph.com', 'www.racepulseph.com', 'racepulseph.web.app', 'racepulseph.firebaseapp.com', 'localhost']);
      const raceId = url.searchParams.get('register')?.trim();
      if (!allowedHosts.has(url.hostname) || !raceId || !/^[A-Za-z0-9_-]{1,64}$/.test(raceId)) {
        setEventQrError('This is not a valid RacePulse event registration QR code.');
        return false;
      }
      setEventQrError('');
      setEventQrMessage('Event found: opening its registration form…');
      setScannedRaceId(raceId);
      selectTab('events');
      window.setTimeout(() => setShowEventQrScanner(false), 450);
      return true;
    } catch {
      setEventQrError('This is not a valid RacePulse event registration QR code.');
      return false;
    }
  };

  const confirmBibClaim = async () => {
    if (!pendingBibClaim || pendingBibClaim.alreadyLinked) {
      setPendingBibClaim(null);
      selectTab('myraces');
      return;
    }
    setClaimingBib(true);
    setBibClaimError('');
    try {
      await claimRaceBib(pendingBibClaim.payload);
      setPendingBibClaim(null);
      selectTab('myraces');
    } catch (error: any) {
      setBibClaimError(error.message || 'Unable to add this race to your account.');
    } finally {
      setClaimingBib(false);
    }
  };

  const openQrScanner = () => {
    setEventQrError('');
    setEventQrMessage('');
    setBibClaimError('');
    setShowEventQrScanner(true);
  };

  const navItems = [
    { key: 'events', icon: <Flag className="w-4 h-4" />, label: 'Events', shortLabel: 'Events', active: tab === 'events', onClick: () => selectTab('events') },
    { key: 'allraces', icon: <Trophy className="w-4 h-4" />, label: 'All Races', shortLabel: 'Catalog', active: tab === 'allraces', onClick: () => selectTab('allraces') },
    { key: 'myraces', icon: <ClipboardList className="w-4 h-4" />, label: 'My Races', shortLabel: 'Passes', active: tab === 'myraces', onClick: () => selectTab('myraces') },
    { key: 'friends', icon: <Users2 className="w-4 h-4" />, label: 'Friends', shortLabel: 'Friends', active: tab === 'friends', onClick: () => selectTab('friends') },
    { key: 'engraving', icon: <Award className="w-4 h-4" />, label: 'Engraving', shortLabel: 'Engrave', active: tab === 'engraving', onClick: () => selectTab('engraving') },
  ].filter(item =>
    item.key === 'myraces' ||
    (item.key === 'allraces'
      ? can('personal.results') || can('personal.register')
      : can(({ events: 'personal.register', friends: 'personal.friends', engraving: 'personal.engraving' })[item.key]))
  );

  const registeredRaceIds = useMemo(
    () => new Set((runnerProfiles || []).map((rp) => rp.raceId)),
    [runnerProfiles],
  );
  const sharedRaceById = useMemo(
    () => new Map(sharedRaces.map((r) => [r.id, r])),
    [sharedRaces],
  );
  const todayStr = philippineTodayStr();
  const totalPassesCount = runnerProfiles?.length ?? 0;
  const upcomingPassesCount = useMemo(
    () =>
      (runnerProfiles || []).filter((rp) => {
        const race = sharedRaceById.get(rp.raceId);
        return !race?.completedAt && (race?.date || '9999') >= todayStr;
      }).length,
    [runnerProfiles, sharedRaceById, todayStr],
  );
  const completedPassesCount = Math.max(0, totalPassesCount - upcomingPassesCount);
  const openEventsCount = useMemo(
    () => sharedRaces.filter((race) => isRaceRegistrationOpen(race)).length,
    [sharedRaces],
  );

  const activeTabMeta: Record<RunnerTab, { title: string; count: number; icon: React.ReactNode }> = {
    events: { title: 'Events & Registration', count: openEventsCount, icon: <Flag className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" /> },
    allraces: { title: 'All Race Events', count: sharedRaces.length, icon: <Trophy className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" /> },
    myraces: { title: 'My Race Passes', count: totalPassesCount, icon: <ClipboardList className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" /> },
    friends: { title: 'Runner Friends', count: friendsCount, icon: <Users2 className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" /> },
    engraving: { title: 'Medal Personalization', count: totalPassesCount, icon: <Award className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" /> },
  };
  const currentMeta = activeTabMeta[tab];

  const headerQuickTabs = navItems.filter((item) => item.key === 'events' || item.key === 'allraces' || item.key === 'myraces');

  const headerLeftMarkup = (
    <div className="flex items-center gap-3 min-w-0">
      <span className="h-5 w-px bg-white/15 shrink-0" aria-hidden="true" />
      <div className="flex items-center gap-2 min-w-0">
        {currentMeta.icon}
        <span className="text-xs font-display font-semibold uppercase tracking-wider text-white whitespace-nowrap truncate">
          {currentMeta.title}
        </span>
        <span className="font-mono text-xs tabular-nums px-2 py-0.5 rounded-md bg-white/10 border border-white/15 text-zinc-200">
          {currentMeta.count}
        </span>
      </div>
    </div>
  );

  const headerRightMarkup = (
    <div className="flex items-center gap-2" role="toolbar" aria-label="Runner quick actions">
      {headerQuickTabs.length > 1 && (
        <div
          className="inline-flex rounded-lg border border-white/15 bg-white/10 p-1 shrink-0"
          role="group"
          aria-label="Quick section switcher"
        >
          {headerQuickTabs.map((item) => {
            const active = tab === item.key;
            const badgeVal =
              item.key === 'myraces' ? totalPassesCount : item.key === 'events' ? openEventsCount : sharedRaces.length;
            return (
              <button
                key={item.key}
                type="button"
                onClick={item.onClick}
                aria-pressed={active}
                className={`h-8 px-2.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${
                  active ? 'bg-red-700 text-white' : 'text-zinc-200 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span>{item.shortLabel}</span>
                <span className={`font-mono text-xs tabular-nums ${active ? 'text-white' : 'text-zinc-300'}`}>
                  {badgeVal}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={openQrScanner}
        className="h-9 px-3 rounded-lg border border-white/15 bg-white/10 hover:border-red-500/50 text-xs font-semibold text-white inline-flex items-center gap-1.5 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      >
        <Camera className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Scan Race / Bib QR</span>
      </button>

      <button
        type="button"
        onClick={() => setShowProfile(true)}
        aria-label="Open profile settings"
        title="Profile and Account Settings"
        className="h-9 px-3 rounded-lg border border-white/15 bg-white/10 hover:border-red-500/50 text-xs font-semibold text-white inline-flex items-center gap-1.5 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      >
        <span className="w-5 h-5 rounded-full overflow-hidden bg-red-700 text-white flex items-center justify-center text-xs font-semibold shrink-0" aria-hidden="true">
          {profile.photoURL ? (
            <img src={profile.photoURL} alt="" width={20} height={20} className="w-full h-full object-cover" />
          ) : (
            (profile.nickname || profile.displayName || 'R').charAt(0).toUpperCase()
          )}
        </span>
        <span>Profile</span>
      </button>
    </div>
  );

  const telemetryLoading = runnerProfiles === undefined;

  return (
    <WorkspaceShell
      spaceTitle="Runner Portal"
      navLabel="Runner navigation"
      items={navItems}
      profile={profile}
      workspaceSwitch={workspaceSwitch}
      pendingApprovalNotice={pendingApprovalNotice}
      maxWidthClass="max-w-[1800px]"
      onOpenProfile={() => setShowProfile(true)}
    >
      {isDesktop && headerCtx?.leftSlotEl ? createPortal(headerLeftMarkup, headerCtx.leftSlotEl) : null}
      {isDesktop && headerCtx?.rightSlotEl ? createPortal(headerRightMarkup, headerCtx.rightSlotEl) : null}

      {/* Mobile-only compact console header + QR + Profile + Sign Out (matching AdminDashboard) */}
      <div className="lg:hidden glass-panel hero-glow flex flex-col sm:flex-row sm:items-center justify-between px-4 py-4 gap-3 animate-fadeIn">
        <div className="min-w-0">
          <span className="text-xs tracking-wider font-semibold text-red-700 dark:text-red-400 uppercase block truncate">
            Runner Portal
          </span>
          <h1 className="heading-float font-semibold tracking-tight font-display text-[var(--text-primary)] truncate text-xl mt-1">
            {profile.displayName}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={openQrScanner}
            className="min-h-11 shrink-0 text-xs text-[var(--text-primary)] border border-[var(--border-default)] hover:border-red-500/40 hover:text-red-700 dark:hover:text-red-400 font-semibold px-3 py-2 rounded-[20px] transition flex items-center gap-1.5 uppercase tracking-wider"
          >
            <Camera className="w-3.5 h-3.5" aria-hidden="true" /> Scan QR
          </button>
          <button
            type="button"
            onClick={() => setShowProfile(true)}
            aria-label="Open profile settings"
            title="Profile and Account Settings"
            className="min-h-11 shrink-0 text-xs text-[var(--text-primary)] border border-[var(--border-default)] hover:border-red-500/40 hover:text-red-700 dark:hover:text-red-400 font-semibold px-3 py-2 rounded-[20px] transition flex items-center gap-2 uppercase tracking-wider"
          >
            <span className="w-5 h-5 rounded-full overflow-hidden bg-red-700 text-white flex items-center justify-center text-xs font-semibold shrink-0" aria-hidden="true">
              {profile.photoURL ? (
                <img src={profile.photoURL} alt="" width={20} height={20} className="w-full h-full object-cover" />
              ) : (
                (profile.nickname || profile.displayName || 'R').charAt(0).toUpperCase()
              )}
            </span>
            <span>Profile</span>
          </button>
          <button
            type="button"
            onClick={() => signOutUser()}
            className="min-h-11 shrink-0 text-xs text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--surface-inset)] hover:text-[var(--text-primary)] font-semibold px-3.5 py-2 rounded-[20px] transition flex items-center gap-1.5 uppercase tracking-wider"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" /> Sign Out
          </button>
        </div>
      </div>

      {/* Runner Portfolio Telemetry Ribbon (matching Admin MyRaceEventsPanel ISO 11064-5 telemetry strip) */}
      <section
        id="runner_portfolio_telemetry"
        aria-label="Runner portfolio summary"
        className="border border-[var(--border-default)] rounded-2xl bg-[var(--surface-card)] px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-2"
      >
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 min-w-0">
          <button
            type="button"
            onClick={() => selectTab('myraces')}
            aria-pressed={tab === 'myraces'}
            className={`min-h-10 lg:min-h-8 px-3 rounded-lg border text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap ${
              tab === 'myraces'
                ? 'border-red-600 bg-red-50 dark:bg-red-950/40 text-[var(--text-primary)]'
                : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] text-[var(--text-secondary)]'
            }`}
          >
            <span className="font-normal">My Passes</span>
            <AnimatedMetricValue
              value={totalPassesCount}
              loading={telemetryLoading}
              skeletonWidthClass="w-5"
              skeletonHeightClass="h-4"
              className="font-mono font-semibold tabular-nums text-[var(--text-primary)]"
            />
          </button>

          <button
            type="button"
            onClick={() => selectTab('myraces')}
            className="min-h-10 lg:min-h-8 px-3 rounded-lg border border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap text-[var(--text-secondary)]"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-emerald-400 shrink-0" aria-hidden="true" />
            <span className="font-normal">Upcoming</span>
            <AnimatedMetricValue
              value={upcomingPassesCount}
              loading={telemetryLoading}
              skeletonWidthClass="w-5"
              skeletonHeightClass="h-4"
              className="font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400"
            />
          </button>

          <button
            type="button"
            onClick={() => selectTab('myraces')}
            className="min-h-10 lg:min-h-8 px-3 rounded-lg border border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap text-[var(--text-secondary)]"
          >
            <span className="font-normal">Completed</span>
            <AnimatedMetricValue
              value={completedPassesCount}
              loading={telemetryLoading}
              skeletonWidthClass="w-5"
              skeletonHeightClass="h-4"
              className="font-mono font-semibold tabular-nums text-[var(--text-primary)]"
            />
          </button>

          {(can('personal.results') || can('personal.register')) && (
            <button
              type="button"
              onClick={() => selectTab('allraces')}
              aria-pressed={tab === 'allraces'}
              className={`min-h-10 lg:min-h-8 px-3 rounded-lg border text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap ${
                tab === 'allraces'
                  ? 'border-red-600 bg-red-50 dark:bg-red-950/40 text-[var(--text-primary)]'
                  : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] text-[var(--text-secondary)]'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-red-600 dark:bg-red-400 shrink-0" aria-hidden="true" />
              <span className="font-normal">Open Events</span>
              <AnimatedMetricValue
                value={openEventsCount}
                skeletonWidthClass="w-5"
                skeletonHeightClass="h-4"
                className="font-mono font-semibold tabular-nums text-red-700 dark:text-red-400"
              />
            </button>
          )}

          {can('personal.friends') && (
            <button
              type="button"
              onClick={() => selectTab('friends')}
              aria-pressed={tab === 'friends'}
              className={`min-h-10 lg:min-h-8 px-3 rounded-lg border text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap ${
                tab === 'friends'
                  ? 'border-red-600 bg-red-50 dark:bg-red-950/40 text-[var(--text-primary)]'
                  : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] text-[var(--text-secondary)]'
              }`}
            >
              <span className="font-normal">Friends</span>
              <AnimatedMetricValue
                value={friendsCount}
                skeletonWidthClass="w-5"
                skeletonHeightClass="h-4"
                className="font-mono font-semibold tabular-nums text-[var(--text-primary)]"
              />
            </button>
          )}
        </div>

        <div className="hidden md:flex items-center gap-2 shrink-0 text-xs text-[var(--text-secondary)]">
          <span className="font-mono px-2.5 py-1 rounded-md bg-[var(--surface-inset)] border border-[var(--border-default)] text-[var(--text-primary)]">
            {profile.username ? `@${profile.username}` : profile.displayName}
          </span>
        </div>
      </section>

      {showProfile && (
        <ProfileModal profile={profile} runnerProfiles={runnerProfiles || []} onClose={() => setShowProfile(false)} />
      )}

      {pendingBibClaim && (
        <DialogSurface
          titleId="pending-bib-claim-title"
          onRequestClose={() => {
            if (!claimingBib) setPendingBibClaim(null);
          }}
          className="w-full max-w-md glass-panel p-6 space-y-5 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="pending-bib-claim-title" className="heading-float text-xl font-semibold font-display uppercase text-[var(--text-primary)]">
                {pendingBibClaim.alreadyLinked ? 'Already in My Races' : 'Add this race bib?'}
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-1">{pendingBibClaim.race.name} • {pendingBibClaim.race.date}</p>
            </div>
            <button
              type="button"
              aria-label="Close bib confirmation dialog"
              onClick={() => setPendingBibClaim(null)}
              disabled={claimingBib}
              className="min-h-11 min-w-11 flex items-center justify-center rounded-full glass-inset text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
          <div className="glass-inset p-4 grid grid-cols-2 gap-x-4 gap-y-3 text-left">
            <span className="col-span-2"><span className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Runner / team</span><span className="block text-sm font-semibold text-[var(--text-primary)] mt-1">{pendingBibClaim.runner.fullName}</span></span>
            <span><span className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Bib number</span><span className="block text-lg font-mono font-semibold text-red-700 dark:text-red-400 mt-1">#{pendingBibClaim.runner.bibNumber}</span></span>
            <span><span className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Distance</span><span className="block text-sm font-semibold text-[var(--text-primary)] mt-1">{pendingBibClaim.runner.distance}</span></span>
            <span><span className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Category</span><span className="block text-sm font-semibold text-[var(--text-primary)] mt-1">{claimableEntryLabel(pendingBibClaim.runner.entryCategory)}</span></span>
            <span><span className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Gender</span><span className="block text-sm font-semibold text-[var(--text-primary)] mt-1 capitalize">{pendingBibClaim.runner.gender}</span></span>
          </div>
          {pendingBibClaim.runner.teamMembers && pendingBibClaim.runner.teamMembers.length > 1 && <p className="text-xs text-[var(--text-secondary)]"><span className="font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Members: </span>{pendingBibClaim.runner.teamMembers.join(' • ')}</p>}
          {bibClaimError && <p role="alert" className="text-xs font-semibold text-red-700 dark:text-red-400">{bibClaimError}</p>}
          <p className="text-xs text-[var(--text-secondary)]">Only confirm if this is your official race bib. Your event, live splits, and published result will appear under My Races.</p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setPendingBibClaim(null)} disabled={claimingBib} className="min-h-11 py-3 rounded-[var(--radius-control)] glass-inset text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Cancel</button>
            <button type="button" onClick={confirmBibClaim} disabled={claimingBib} className="min-h-11 py-3 rounded-[var(--radius-control)] bg-gradient-to-r from-red-700 to-red-800 text-white text-xs font-semibold uppercase tracking-widest shadow-lg shadow-red-900/30 disabled:opacity-60">{claimingBib ? 'Adding...' : pendingBibClaim.alreadyLinked ? 'Open My Races' : 'Confirm & Add Race'}</button>
          </div>
        </DialogSurface>
      )}

      {runnerProfiles === undefined ? (
        <ViewLoadingSkeleton label="Loading runner portal" />
      ) : (
        <AnimatedTabView tabKey={tab} direction={tabDirection} className="space-y-5">
          {tab === 'events' && can('personal.register') && (
            <>
              <RunnerReminderCenter runnerProfiles={runnerProfiles} />
              <RaceRegistrationForm
                uid={profile.uid}
                friendIdentity={{ username: profile.username, displayName: profile.nickname || profile.displayName }}
                runnerProfiles={runnerProfiles}
                registeredRaceIds={registeredRaceIds}
                initialShirtSize={profile.shirtSize}
                requestedRaceId={scannedRaceId || pendingDeepLinkRaceId}
                onRequestedRaceHandled={() => { setScannedRaceId(null); setPendingDeepLinkRaceId(null); }}
                onBrowseAllRaces={() => selectTab('allraces')}
                onSaved={() => selectTab('myraces')}
              />
            </>
          )}

          {tab === 'myraces' && (
            <>
              <RunnerReminderCenter runnerProfiles={runnerProfiles} />
              <MyRacesView uid={profile.uid} runnerProfiles={runnerProfiles} onBrowseEvents={() => selectTab('events')} />
            </>
          )}

          {tab === 'allraces' && (
            <AllRacesView
              registeredRaceIds={registeredRaceIds}
              onRegister={(raceId) => {
                setScannedRaceId(raceId);
                selectTab('events');
              }}
            />
          )}

          {tab === 'friends' && can('personal.friends') && (
            <FriendsView profile={profile} onOpenRace={(raceId) => { setScannedRaceId(raceId); selectTab('events'); }} />
          )}

          {tab === 'engraving' && can('personal.engraving') && (
            <RunnerEngravingView
              profile={profile}
              runnerProfiles={runnerProfiles}
              onBackToMyRaces={() => selectTab('myraces')}
            />
          )}
        </AnimatedTabView>
      )}

      {showEventQrScanner && (
        <QrScannerModal
          onClose={() => setShowEventQrScanner(false)}
          onScanSuccess={scanEventQr}
          successMessage={eventQrMessage}
          errorMessage={eventQrError}
          title="Scan Race or Bib QR"
          subtitle="OPEN EVENT OR ADD MY RACE"
          instructions="Scan an organizer event QR to open registration, or scan the QR printed on your race bib to add that event and its result to My Races."
        />
      )}
    </WorkspaceShell>
  );
}

// ========== RUNNER ENGRAVING AUTOFILL ==========

function RunnerEngravingView({
  profile,
  runnerProfiles,
  onBackToMyRaces,
}: {
  profile: UserProfile;
  runnerProfiles: RunnerProfile[];
  onBackToMyRaces: () => void;
}) {
  const [races, setRaces] = useState<Race[]>([]);
  const [resultsByRaceId, setResultsByRaceId] = useState<Record<string, PublicLiveResults | null>>({});

  useEffect(() => {
    return subscribeSharedRaces((rawList, loaded, err) => {
      if (err) {
        console.warn('Engraving races listener failed:', err);
        return;
      }
      if (loaded) setRaces(rawList);
    });
  }, []);

  const uniqueRaceIds = useMemo(
    () => Array.from(new Set(runnerProfiles.map((rp) => rp.raceId))).sort(),
    [runnerProfiles],
  );

  useEffect(() => {
    if (uniqueRaceIds.length === 0) {
      setResultsByRaceId({});
      return;
    }
    const unsubscribes = uniqueRaceIds.map((raceId) =>
      onSnapshot(
        doc(db, 'liveResults', raceId),
        (snapshot) => {
          setResultsByRaceId((prev) => ({
            ...prev,
            [raceId]: snapshot.exists() ? (snapshot.data() as PublicLiveResults) : null,
          }));
        },
        () => {
          setResultsByRaceId((prev) => ({ ...prev, [raceId]: null }));
        },
      ),
    );
    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [uniqueRaceIds]);

  const raceById = useMemo(() => new Map(races.map((r) => [r.id, r])), [races]);

  const racePrefills = useMemo<EngravingRacePrefill[]>(() => {
    return [...runnerProfiles]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((rp) => {
        const race = raceById.get(rp.raceId);
        const liveSummary = resultsByRaceId[rp.raceId];
        const entry = liveSummary?.officialResults?.find((item) => item.bibNumber === rp.bibNumber);
        const overallRank = entry ? (entry.overallRank ?? entry.rank) : undefined;
        const rankText = overallRank
          ? `#${overallRank}${entry?.categoryRank ? ` (${entry.categoryLabel || 'Cat'} #${entry.categoryRank})` : ''}`
          : undefined;
        return {
          key: `${rp.raceId}_${rp.bibNumber}`,
          label: `${race?.name || rp.raceId} · ${rp.distance} · Bib #${rp.bibNumber}`,
          runnerName: rp.fullName || profile.displayName || '',
          bibNumber: rp.bibNumber,
          distance: rp.distance,
          finishingTime: entry?.finishTime,
          rank: rankText,
        };
      });
  }, [runnerProfiles, raceById, resultsByRaceId, profile.displayName]);

  const fallbackProfile = runnerProfiles[0];
  return (
    <CustomerForm
      embedded
      onBackToRoleSelection={onBackToMyRaces}
      backLabel="← Back to My Races"
      ownerUid={profile.uid}
      initialRunnerName={fallbackProfile?.fullName || profile.displayName || ''}
      initialBibNumber={fallbackProfile?.bibNumber || ''}
      racePrefills={racePrefills}
    />
  );
}

// ========== ALL PUBLIC RACES ==========

// This is deliberately separate from My Races: a runner can browse every
// public event and its published standings without adding that event to their
// personal registration list.
function AllRacesView({ onRegister, registeredRaceIds }: { onRegister: (raceId: string) => void; registeredRaceIds?: Set<string> }) {
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [distanceFilter, setDistanceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'upcoming' | 'completed'>('all');

  useEffect(() => {
    return subscribeSharedRaces((rawList, loaded, err) => {
      if (err) {
        console.warn('All races listener failed:', err);
        return;
      }
      if (!loaded) return;
      const list = [...rawList].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setRaces(list);
    });
  }, []);

  const availableDistances = useMemo(() => {
    const labels = new Set<string>();
    races.forEach((race) => (race.distances || []).forEach((d) => labels.add(d.label)));
    return Array.from(labels).sort((a, b) => {
      const na = parseFloat(a);
      const nb = parseFloat(b);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }, [races]);

  const today = philippineTodayStr();

  const statusCounts = useMemo(() => {
    const upcomingCount = races.filter((race) => !race.completedAt && race.date >= today).length;
    const completedCount = races.length - upcomingCount;
    return { all: races.length, upcoming: upcomingCount, completed: completedCount };
  }, [races, today]);

  const filteredRaces = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return races.filter((race) => {
      const isDone = !!race.completedAt || race.date < today;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'upcoming' && !isDone) ||
        (statusFilter === 'completed' && isDone);
      const matchesSearch =
        !term ||
        race.name.toLowerCase().includes(term) ||
        race.date.includes(term) ||
        (race.distances || []).some((d) => d.label.toLowerCase().includes(term));
      const matchesDistance =
        distanceFilter === 'all' ||
        (race.distances || []).some((d) => d.label === distanceFilter);
      return matchesStatus && matchesSearch && matchesDistance;
    });
  }, [races, statusFilter, searchQuery, distanceFilter, today]);

  const activeRaces = filteredRaces.filter((race) => !race.completedAt && race.date >= today);
  const doneRaces = filteredRaces.filter((race) => !!race.completedAt || race.date < today);
  const selectedRace = races.find((race) => race.id === selectedRaceId);
  const selectRace = (raceId: string) => {
    setSelectedRaceId(raceId);
    requestAnimationFrame(() => document.getElementById('runner-public-race-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const hasFilters = Boolean(searchQuery || distanceFilter !== 'all' || statusFilter !== 'all');

  return (
    <div className="space-y-6 pb-8">
      <div className="border border-[var(--border-default)] rounded-2xl bg-[var(--surface-card)] p-3 sm:p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <h2 className="text-sm font-semibold font-display uppercase tracking-wider text-[var(--text-primary)] whitespace-nowrap">
              Event Catalog
            </h2>
            <div
              className="inline-flex rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] p-1 shrink-0"
              role="group"
              aria-label="Filter races by status"
            >
              {(
                [
                  { key: 'all', label: 'All', count: statusCounts.all },
                  { key: 'upcoming', label: 'Upcoming', count: statusCounts.upcoming },
                  { key: 'completed', label: 'Completed', count: statusCounts.completed },
                ] as const
              ).map((item) => {
                const active = statusFilter === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setStatusFilter(item.key)}
                    aria-pressed={active}
                    className={`min-h-8 px-2.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-red-700 text-white'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <span>{item.label}</span>
                    <span className={`font-mono text-xs tabular-nums ${active ? 'text-white' : 'text-[var(--text-secondary)]'}`}>
                      {item.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 lg:min-w-[340px]">
            <label className="relative flex-1 block">
              <span className="sr-only">Search events by race name, date, or distance</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-[var(--text-secondary)]" aria-hidden="true" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search race, date, or distance"
                className="w-full min-h-10 glass-inset py-2 pl-9 pr-3 text-xs sm:text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
              />
            </label>
            {hasFilters && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); setDistanceFilter('all'); setStatusFilter('all'); }}
                className="min-h-10 shrink-0 px-3 py-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] transition"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--border-subtle)]">
          {availableDistances.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter races by distance">
              <button
                type="button"
                onClick={() => setDistanceFilter('all')}
                aria-pressed={distanceFilter === 'all'}
                className={`min-h-9 px-3 py-1 rounded-full border text-xs font-semibold transition-colors ${
                  distanceFilter === 'all'
                    ? 'border-red-600 bg-red-700 text-white'
                    : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600'
                }`}
              >
                All distances
              </button>
              {availableDistances.map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setDistanceFilter(label)}
                  aria-pressed={distanceFilter === label}
                  className={`min-h-9 px-3 py-1 rounded-full border text-xs font-semibold transition-colors ${
                    distanceFilter === label
                      ? 'border-red-600 bg-red-700 text-white'
                      : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : <span />}

          <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
            Showing {filteredRaces.length} / {races.length} events
          </span>
        </div>
      </div>

      {statusFilter !== 'completed' && (
        <RaceList
          races={activeRaces}
          onSelectRace={selectRace}
          selectedRaceId={selectedRaceId}
          registeredRaceIds={registeredRaceIds}
          title="Active & Upcoming Races"
          subtitle="Browse every published RacePulsePH event. Registration is optional."
          actionLabel="View Race"
          emptyTitle={hasFilters ? 'No matching active races' : 'No active or upcoming races'}
          emptyDescription={hasFilters ? 'Try another search term or clear filters above.' : 'Check back soon for the next event.'}
        />
      )}

      {statusFilter !== 'upcoming' && (
        <RaceList
          races={doneRaces}
          onSelectRace={selectRace}
          selectedRaceId={selectedRaceId}
          registeredRaceIds={registeredRaceIds}
          title="Done & Past Races"
          subtitle="View official rankings, finish times, and digital certificates."
          actionLabel="View Official Results"
          emptyTitle={hasFilters ? 'No matching past races' : 'No completed races yet'}
          emptyDescription={hasFilters ? 'Try another search term or clear filters above.' : 'Completed events will be archived here.'}
        />
      )}

      {selectedRace && (
        <div id="runner-public-race-results" className="scroll-mt-6">
          <PublicRaceResults
            race={selectedRace}
            onRegister={onRegister}
            registerLabel="Register for this race"
          />
        </div>
      )}
    </div>
  );
}

// ========== MY RACES ==========

interface MyRacesViewProps {
  uid: string;
  runnerProfiles: RunnerProfile[];
  onBrowseEvents: () => void;
}

function MyRacesView({ runnerProfiles, onBrowseEvents }: MyRacesViewProps) {
  const { can, authority } = useAccess();
  const [races, setRaces] = useState<Race[]>([]);
  const [viewingProfile, setViewingProfile] = useState<RunnerProfile | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'upcoming' | 'completed'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    return subscribeSharedRaces((rawList, loaded, err) => {
      if (err) {
        console.warn('Races listener failed:', err);
        return;
      }
      if (loaded) setRaces(rawList);
    });
  }, []);

  if (viewingProfile) {
    const viewedRace = races.find((race) => race.id === viewingProfile.raceId);
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setViewingProfile(null)}
          className="min-h-11 py-2 text-xs font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 flex items-center gap-2 transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Back to My Races
        </button>
        {viewedRace?.routeGpxUrl && <RouteMap3D gpxUrl={viewedRace.routeGpxUrl} fileName={viewedRace.routeGpxFileName} raceName={viewedRace.name} />}
        {can('personal.results') ? <RunnerSplitsView runnerProfile={viewingProfile} /> : viewedRace && can('personal.bibs') ? <DigitalRaceBib race={viewedRace} runnerProfile={viewingProfile} /> : <p>Results access is disabled for this account.</p>}
      </div>
    );
  }

  const raceById = new Map(races.map((r) => [r.id, r]));
  const todayStr = philippineTodayStr();
  // The organizer can close a race before its scheduled date (or correct a
  // date later). Treat completedAt as the source of truth so an official Done
  // Race always remains visible in the runner's own race archive.
  const isDoneRace = (profile: RunnerProfile) => {
    const race = raceById.get(profile.raceId);
    return !!race?.completedAt || (race?.date || '9999') < todayStr;
  };
  const upcomingAll = runnerProfiles.filter((rp) => !isDoneRace(rp));
  const pastAll = runnerProfiles.filter(isDoneRace);
  const term = searchQuery.trim().toLowerCase();
  const matchesTerm = (rp: RunnerProfile) => {
    if (!term) return true;
    const race = raceById.get(rp.raceId);
    return (
      (race?.name || '').toLowerCase().includes(term) ||
      (race?.date || '').includes(term) ||
      rp.distance.toLowerCase().includes(term) ||
      rp.bibNumber.toLowerCase().includes(term)
    );
  };
  const upcoming = upcomingAll.filter(matchesTerm);
  const past = pastAll.filter(matchesTerm);

  return (
    <div className="space-y-5">
      {runnerProfiles.length === 0 ? (
        <>
          <button
            type="button"
            onClick={onBrowseEvents}
            className="min-h-11 w-full py-3 px-6 rounded-[var(--radius-control)] font-display font-semibold uppercase text-xs tracking-widest shadow-xl flex items-center justify-center gap-2 transition duration-200 text-white bg-gradient-to-r from-red-700 to-red-800 hover:from-red-600 hover:to-red-700 shadow-red-900/30"
          >
            <Flag className="w-4 h-4" aria-hidden="true" /> Browse All Events
          </button>
          <div className="glass-panel p-8 text-center space-y-2">
            <Flag className="w-8 h-8 text-[var(--text-secondary)] mx-auto" aria-hidden="true" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">You're not registered for any races yet</p>
            <p className="text-xs text-[var(--text-secondary)]">Tap "Browse All Events" above, or the Events tab below, to see what's on offer.</p>
          </div>
        </>
      ) : (
        <>
          <div className="border border-[var(--border-default)] rounded-2xl bg-[var(--surface-card)] p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 min-w-0">
              <h2 className="text-sm font-semibold font-display uppercase tracking-wider text-[var(--text-primary)] whitespace-nowrap">
                My Race Passes
              </h2>
              <div
                className="inline-flex rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] p-1 shrink-0"
                role="group"
                aria-label="Filter registered passes"
              >
                {(
                  [
                    { key: 'all', label: 'All', count: runnerProfiles.length },
                    { key: 'upcoming', label: 'Upcoming', count: upcomingAll.length },
                    { key: 'completed', label: 'Completed', count: pastAll.length },
                  ] as const
                ).map((item) => {
                  const active = statusFilter === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setStatusFilter(item.key)}
                      aria-pressed={active}
                      className={`min-h-8 px-2.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-red-700 text-white'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <span>{item.label}</span>
                      <span className={`font-mono text-xs tabular-nums ${active ? 'text-white' : 'text-[var(--text-secondary)]'}`}>
                        {item.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <label className="relative flex-1 sm:w-60 block">
                <span className="sr-only">Search race passes by event, distance, or bib number</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-[var(--text-secondary)]" aria-hidden="true" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search race pass or bib #..."
                  className="w-full min-h-9 glass-inset py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
                />
              </label>
              <button
                type="button"
                onClick={onBrowseEvents}
                className="min-h-9 px-3 py-1.5 rounded-lg border border-red-700/35 bg-red-500/10 text-red-700 dark:text-red-400 hover:bg-red-700 hover:text-white text-xs font-semibold uppercase tracking-wide inline-flex items-center gap-1.5 transition shrink-0"
              >
                <Flag className="w-3.5 h-3.5" aria-hidden="true" /> Find a race
              </button>
            </div>
          </div>

          {statusFilter !== 'completed' && (
            <RaceProfileSection
              title="Upcoming Races"
              profiles={upcoming}
              raceById={raceById}
              onSelect={setViewingProfile}
              emptyText={term ? 'No upcoming passes match your search.' : 'No upcoming races.'}
            />
          )}

          {statusFilter !== 'upcoming' && (
            <RaceProfileSection
              title="Done & Past Races"
              profiles={past}
              raceById={raceById}
              onSelect={setViewingProfile}
              emptyText={term ? 'No completed passes match your search.' : 'No done or past races yet.'}
            />
          )}
        </>
      )}
    </div>
  );
}

// ========== FRIENDS & RACE INVITES ==========

interface FriendRequestRecord {
  fromUid: string;
  toUid: string;
  fromUsername: string;
  fromDisplayName: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
  respondedAt?: string;
}

interface FriendshipRecord {
  fromUid: string;
  toUid: string;
  members: string[];
  createdAt: string;
}

interface RaceInviteRecord {
  fromUid: string;
  toUid: string;
  raceId: string;
  raceName: string;
  raceDate: string;
  fromDisplayName: string;
  createdAt: string;
  status: 'pending' | 'opened';
}

function FriendsView({ profile, onOpenRace }: { profile: UserProfile; onOpenRace: (raceId: string) => void }) {
  const { can, authority } = useAccess();
  const [searchUsername, setSearchUsername] = useState('');
  const [searchResult, setSearchResult] = useState<FriendProfile | null>(null);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [activities, setActivities] = useState<Record<string, FriendActivity>>({});
  const [incoming, setIncoming] = useState<FriendRequestRecord[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestRecord[]>([]);
  const [invites, setInvites] = useState<RaceInviteRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [friendFilter, setFriendFilter] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => onSnapshot(query(collection(db, 'friendRequests'), where('toUid', '==', profile.uid)), (snapshot) => {
    const records: FriendRequestRecord[] = [];
    snapshot.forEach((item) => records.push(item.data() as FriendRequestRecord));
    setIncoming(records.filter((item) => item.status === 'pending').sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }, (err) => console.warn('Friend requests listener failed:', err)), [profile.uid]);

  useEffect(() => onSnapshot(query(collection(db, 'friendRequests'), where('fromUid', '==', profile.uid)), (snapshot) => {
    const records: FriendRequestRecord[] = [];
    snapshot.forEach((item) => records.push(item.data() as FriendRequestRecord));
    setOutgoing(records.filter((item) => item.status === 'pending'));
  }, (err) => console.warn('Outgoing friend requests listener failed:', err)), [profile.uid]);

  useEffect(() => onSnapshot(query(collection(db, 'raceInvites'), where('toUid', '==', profile.uid)), (snapshot) => {
    const records: RaceInviteRecord[] = [];
    snapshot.forEach((item) => records.push(item.data() as RaceInviteRecord));
    setInvites(records.filter((item) => item.status === 'pending').sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }, (err) => console.warn('Race invites listener failed:', err)), [profile.uid]);

  useEffect(() => onSnapshot(query(collection(db, 'friendships'), where('members', 'array-contains', profile.uid)), (snapshot) => {
    const connections: FriendshipRecord[] = [];
    snapshot.forEach((item) => connections.push(item.data() as FriendshipRecord));
    void (async () => {
      try {
        const friendIds = connections.map((item) => item.fromUid === profile.uid ? item.toUid : item.fromUid);
        const loaded = await Promise.all(friendIds.map(async (uid) => {
          const [friendProfile, activity] = await Promise.all([getDoc(doc(db, 'friendProfiles', uid)), getDoc(doc(db, 'friendActivities', uid))]);
          return {
            profile: friendProfile.exists() ? friendProfile.data() as FriendProfile : null,
            activity: activity.exists() ? activity.data() as FriendActivity : null,
          };
        }));
        setFriends(loaded.map((item) => item.profile).filter((item): item is FriendProfile => item !== null).sort((a, b) => a.displayName.localeCompare(b.displayName)));
        setActivities(Object.fromEntries(loaded.filter((item) => item.profile && item.activity).map((item) => [item.profile!.uid, item.activity!])));
      } catch (err) {
        console.warn('Failed to load friend cards:', err);
      }
    })();
  }, (err) => console.warn('Friendships listener failed:', err)), [profile.uid]);

  const search = async () => {
    const username = searchUsername.trim().toLowerCase();
    setError('');
    setNotice('');
    setSearchResult(null);
    if (!usernamePattern.test(username)) {
      setError('Enter an exact username (3–24 letters, numbers, dots, hyphens, or underscores).');
      return;
    }
    setBusy(true);
    try {
      const directory = await getDoc(doc(db, 'friendDirectory', username));
      if (!directory.exists()) {
        setError('No runner profile found for that username.');
      } else if ((directory.data() as FriendProfile).uid === profile.uid) {
        setError('That is your own profile.');
      } else {
        setSearchResult(directory.data() as FriendProfile);
      }
    } catch {
      setError('Could not search right now. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const sendFriendRequest = async () => {
    if (!searchResult || !profile.username) return;
    setBusy(true);
    setError('');
    try {
      if (friends.some((friend) => friend.uid === searchResult.uid)) {
        setNotice('You are already friends.');
        return;
      }
      if (outgoing.some((request) => request.toUid === searchResult.uid)) {
        setNotice('Friend request already sent.');
        return;
      }
      await setDoc(doc(db, 'friendRequests', `${profile.uid}_${searchResult.uid}`), {
        fromUid: profile.uid,
        toUid: searchResult.uid,
        fromUsername: profile.username,
        fromDisplayName: profile.nickname || profile.displayName,
        status: 'pending',
        createdAt: new Date().toISOString(),
      } satisfies FriendRequestRecord);
      setNotice(`Friend request sent to @${searchResult.username}.`);
    } catch (err: any) {
      setError(err.message || 'Could not send the friend request.');
    } finally {
      setBusy(false);
    }
  };

  const respondToRequest = async (request: FriendRequestRecord, accepted: boolean) => {
    setBusy(true);
    setError('');
    try {
      const requestRef = doc(db, 'friendRequests', `${request.fromUid}_${request.toUid}`);
      if (accepted) {
        const batch = writeBatch(db);
        batch.update(requestRef, { status: 'accepted', respondedAt: new Date().toISOString() });
        batch.set(doc(db, 'friendships', `${request.fromUid}_${request.toUid}`), {
          fromUid: request.fromUid,
          toUid: request.toUid,
          members: [request.fromUid, request.toUid],
          createdAt: new Date().toISOString(),
        } satisfies FriendshipRecord);
        await batch.commit();
      } else {
        await updateDoc(requestRef, { status: 'declined', respondedAt: new Date().toISOString() });
      }
    } catch (err: any) {
      setError(err.message || 'Could not update this request.');
    } finally {
      setBusy(false);
    }
  };

  const openInvite = async (invite: RaceInviteRecord) => {
    try {
      await updateDoc(doc(db, 'raceInvites', `${invite.fromUid}_${invite.toUid}_${invite.raceId}`), { status: 'opened' });
    } catch {
      // The registration link is still safe to open if marking it read fails.
    }
    onOpenRace(invite.raceId);
  };

  if (!profile.username) {
    return <div className="glass-panel p-8 text-center space-y-2"><Users2 className="w-9 h-9 text-red-700 dark:text-red-400 mx-auto" aria-hidden="true" /><h2 className="text-base font-semibold text-[var(--text-primary)]">Choose a username first</h2><p className="text-xs text-[var(--text-secondary)]">Open your profile and save a unique username to use Friends. We use usernames so email addresses stay private.</p></div>;
  }

  const friendFilterTerm = friendFilter.trim().toLowerCase();
  const visibleFriends = friendFilterTerm
    ? friends.filter(
        (friend) =>
          friend.displayName.toLowerCase().includes(friendFilterTerm) ||
          (friend.nickname || '').toLowerCase().includes(friendFilterTerm) ||
          friend.username.toLowerCase().includes(friendFilterTerm),
      )
    : friends;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start animate-fadeIn">
      <div className="lg:col-span-5 space-y-5">
        <div className="glass-panel p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-red-700/10 text-red-700 dark:bg-red-500/10 dark:text-red-400">
              <Users2 className="w-5 h-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-base font-semibold font-display uppercase tracking-tight text-[var(--text-primary)]">Find Runner Friends</h2>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">Search by username. Both runners confirm before profiles and recent races are shared.</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap sm:flex-nowrap gap-2">
            <input
              value={searchUsername}
              onChange={(event) => setSearchUsername(event.target.value.toLowerCase())}
              onKeyDown={(event) => { if (event.key === 'Enter') void search(); }}
              placeholder="Search exact username, e.g. juan.runner"
              autoCapitalize="none"
              autoCorrect="off"
              maxLength={24}
              className="min-w-0 flex-1 min-h-11 glass-inset px-3 py-2 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
            />
            <button
              type="button"
              onClick={() => void search()}
              disabled={busy}
              className="min-h-11 rounded-xl bg-red-700 hover:bg-red-800 px-4 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-60"
            >
              Search
            </button>
          </div>
          {error && <p role="alert" className="mt-3 text-xs text-red-700 dark:text-red-400">{error}</p>}
          {notice && <p role="status" className="mt-3 text-xs text-emerald-700 dark:text-emerald-400">{notice}</p>}
          {searchResult && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-[var(--border-default)] bg-[var(--surface-inset)]/50 p-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-red-700/10 dark:bg-red-500/10 font-semibold text-red-700 dark:text-red-400">
                  {searchResult.photoURL ? <img src={searchResult.photoURL} alt="" className="h-full w-full object-cover" /> : searchResult.displayName.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-sm text-[var(--text-primary)]">{searchResult.nickname || searchResult.displayName}</strong>
                  <small className="block text-xs font-mono text-[var(--text-secondary)]">@{searchResult.username}</small>
                </span>
              </div>
              <button
                type="button"
                onClick={() => void sendFriendRequest()}
                disabled={busy}
                className="shrink-0 min-h-11 inline-flex items-center rounded-xl border border-red-700/30 dark:border-red-400/30 bg-red-700/10 dark:bg-red-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-400 transition hover:bg-red-700 hover:text-white disabled:opacity-60"
              >
                <UserPlus className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" /> Add
              </button>
            </div>
          )}
        </div>

        {invites.length > 0 && (
          <div className="glass-panel p-5 space-y-3">
            <h3 className="text-xs font-semibold font-display uppercase tracking-widest text-violet-700 dark:text-violet-400">Race invitations</h3>
            <div className="space-y-2">
              {invites.map((invite) => (
                <div key={`${invite.fromUid}_${invite.raceId}`} className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-violet-500/20 border-l-4 border-l-violet-600 bg-violet-500/5 p-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[var(--text-primary)]">{invite.raceName}</p>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">Invited by {invite.fromDisplayName} • {invite.raceDate}</p>
                  </div>
                  <button type="button" onClick={() => void openInvite(invite)} className="shrink-0 min-h-11 inline-flex items-center rounded-xl bg-violet-700 hover:bg-violet-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white">View event</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {incoming.length > 0 && (
          <div className="glass-panel p-5 space-y-3">
            <h3 className="text-xs font-semibold font-display uppercase tracking-widest text-amber-800 dark:text-amber-300">Friend requests</h3>
            <div className="space-y-2">
              {incoming.map((request) => (
                <div key={`${request.fromUid}_${request.toUid}`} className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[var(--border-default)] border-l-4 border-l-amber-500 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{request.fromDisplayName}</p>
                    <p className="text-xs font-mono text-[var(--text-secondary)]">@{request.fromUsername} wants to connect.</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void respondToRequest(request, false)} disabled={busy} className="min-h-11 inline-flex items-center rounded-xl glass-inset px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Decline</button>
                    <button type="button" onClick={() => void respondToRequest(request, true)} disabled={busy} className="min-h-11 inline-flex items-center rounded-xl bg-emerald-700 hover:bg-emerald-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white"><UserCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" /> Accept</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="lg:col-span-7 glass-panel p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold font-display uppercase tracking-wider text-[var(--text-primary)]">Connected Runner Friends</h3>
            <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-md bg-[var(--surface-inset)] border border-[var(--border-default)] text-red-700 dark:text-red-400">
              {friends.length}
            </span>
          </div>
          {friends.length > 0 && (
            <label className="relative w-full sm:w-64 block">
              <span className="sr-only">Filter connected friends</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-[var(--text-secondary)]" aria-hidden="true" />
              <input
                type="search"
                value={friendFilter}
                onChange={(e) => setFriendFilter(e.target.value)}
                placeholder="Filter by name or @username..."
                className="w-full min-h-9 glass-inset py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
              />
            </label>
          )}
        </div>

        {friends.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)]">No friends yet. Search their username on the left to send your first request.</p>
        ) : visibleFriends.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)]">No connected friends match "{friendFilter}".</p>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {visibleFriends.map((friend) => {
              const activity = activities[friend.uid];
              return (
                <div key={friend.uid} className="rounded-2xl border border-[var(--border-default)] border-l-4 border-l-red-600 bg-[var(--surface-elevated)] p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-red-700/10 dark:bg-red-500/10 font-semibold text-red-700 dark:text-red-400">
                      {friend.photoURL ? <img src={friend.photoURL} alt="" className="h-full w-full object-cover" /> : friend.displayName.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{friend.nickname || friend.displayName}</p>
                      <p className="text-xs font-mono text-[var(--text-secondary)]">@{friend.username}</p>
                    </div>
                  </div>
                  <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
                    <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Recent races</p>
                    {activity?.recentRaces?.length ? (
                      <div className="mt-2 space-y-1.5">
                        {activity.recentRaces.slice(0, 3).map((race) => (
                          <p key={`${race.raceId}_${race.distance}`} className="text-xs text-[var(--text-secondary)]">
                            <strong className="text-[var(--text-primary)]">{race.raceName}</strong>{' '}
                            <span className="font-mono text-red-700 dark:text-red-400">• {race.distance}</span>{' '}
                            <span className="font-mono text-[var(--text-secondary)]">• {race.date}</span>
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">No shared race activity yet.</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function InviteFriendsToRace({ uid, senderName, race }: { uid: string; senderName: string; race: Race }) {
  const { can, authority } = useAccess();
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    return onSnapshot(query(collection(db, 'friendships'), where('members', 'array-contains', uid)), (snapshot) => {
      const connections: FriendshipRecord[] = [];
      snapshot.forEach((item) => connections.push(item.data() as FriendshipRecord));
      void (async () => {
        try {
          const loaded = await Promise.all(connections.map(async (connection) => {
            const friendUid = connection.fromUid === uid ? connection.toUid : connection.fromUid;
            const friend = await getDoc(doc(db, 'friendProfiles', friendUid));
            return friend.exists() ? friend.data() as FriendProfile : null;
          }));
          setFriends(loaded.filter((item): item is FriendProfile => item !== null));
        } catch (err) {
          console.warn('Failed to load friends for race invite:', err);
        }
      })();
    }, (err) => console.warn('Race invite friends listener failed:', err));
  }, [open, uid]);

  const invite = async (friend: FriendProfile) => {
    setSendingTo(friend.uid);
    setMessage('');
    try {
      await setDoc(doc(db, 'raceInvites', `${uid}_${friend.uid}_${race.id}`), {
        fromUid: uid,
        toUid: friend.uid,
        raceId: race.id,
        raceName: race.name,
        raceDate: race.date,
        fromDisplayName: senderName,
        createdAt: new Date().toISOString(),
        status: 'pending',
      } satisfies RaceInviteRecord);
      setMessage(`Invite sent to ${friend.nickname || friend.displayName}.`);
    } catch (err: any) {
      setMessage(err.message || 'Could not send the race invite.');
    } finally {
      setSendingTo(null);
    }
  };

  return (
    <div className="rounded-[16px] border border-violet-500/20 bg-violet-500/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold text-[var(--text-primary)]">Running with friends?</p><p className="mt-1 text-xs text-[var(--text-secondary)]">Send this event straight to an accepted RacePulse friend.</p></div><button type="button" onClick={() => { setOpen((value) => !value); setMessage(''); }} className="min-h-11 inline-flex items-center rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400 transition hover:bg-violet-700 hover:text-white"><UserPlus className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" /> Invite friends</button></div>
      {open && <div className="mt-3 border-t border-violet-500/15 pt-3"><p className="text-xs font-semibold uppercase tracking-widest text-violet-700 dark:text-violet-400">Choose friend</p>{friends.length === 0 ? <p className="mt-2 text-xs text-[var(--text-secondary)]">No accepted friends yet. Add friends first from the Friends tab.</p> : <div className="mt-2 space-y-2">{friends.map((friend) => <div key={friend.uid} className="flex items-center justify-between gap-2 rounded-xl bg-black/10 px-3 py-2"><span className="min-w-0"><strong className="block truncate text-xs text-[var(--text-primary)]">{friend.nickname || friend.displayName}</strong><small className="text-xs text-[var(--text-secondary)]">@{friend.username}</small></span><button type="button" onClick={() => void invite(friend)} disabled={sendingTo === friend.uid} className="min-h-11 inline-flex items-center rounded-lg bg-violet-700 hover:bg-violet-800 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:opacity-60">{sendingTo === friend.uid ? 'Sending…' : 'Invite'}</button></div>)}</div>}{message && <p className={`mt-2 text-xs ${message.startsWith('Invite sent') ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>{message}</p>}</div>}
    </div>
  );
}

function RaceProfileSection({
  title,
  profiles,
  raceById,
  onSelect,
  emptyText,
  headerAction,
}: {
  title: string;
  profiles: RunnerProfile[];
  raceById: Map<string, Race>;
  onSelect: (p: RunnerProfile) => void;
  emptyText: string;
  headerAction?: React.ReactNode;
}) {
  const { can, authority } = useAccess();
  const today = philippineTodayStr();
  return (
    <div className="border border-[var(--border-default)] rounded-2xl bg-[var(--surface-card)] p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold font-display uppercase tracking-widest text-[var(--text-primary)]">{title}</h3>
          <span className="font-mono text-xs font-semibold tabular-nums px-2 py-0.5 rounded-md bg-[var(--surface-inset)] border border-[var(--border-default)] text-[var(--text-secondary)]">
            {profiles.length}
          </span>
        </div>
        {headerAction}
      </div>
      {profiles.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)] py-2">{emptyText}</p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {profiles.map((p) => {
            const race = raceById.get(p.raceId);
            const isCompleted = !!race && (Boolean(race.completedAt) || race.date < today);
            const isRaceDay = !!race && !race.completedAt && race.date === today;
            const raceStatus = !race
              ? 'Saved Pass'
              : isCompleted
                ? 'Race completed'
                : isRaceDay
                  ? 'Race day'
                  : 'Upcoming';
            const leftBorderClass = isCompleted
              ? 'border-l-zinc-500'
              : isRaceDay
                ? 'border-l-red-600'
                : 'border-l-emerald-600';
            return (
              <button
                key={p.raceId}
                type="button"
                onClick={() => onSelect(p)}
                className={`group w-full rounded-2xl border border-[var(--border-default)] border-l-4 ${leftBorderClass} bg-[var(--surface-elevated)] hover:border-red-600/60 p-3.5 sm:p-4 text-left flex items-center justify-between gap-3 transition-colors`}
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="w-16 h-11 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-inset)] overflow-hidden shrink-0 flex items-center justify-center">
                    {race?.posterImage ? (
                      <img
                        src={race.posterImage}
                        alt={`${race.name} poster`}
                        width={64}
                        height={44}
                        className="w-16 h-11 object-cover block"
                      />
                    ) : (
                      <Flag className="w-4 h-4 text-[var(--text-secondary)]" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm sm:text-base font-display font-semibold text-[var(--text-primary)] group-hover:text-red-700 dark:group-hover:text-red-400 truncate transition-colors">
                      {race?.name || 'Registered Race Event'}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[var(--text-secondary)] mt-1">
                      <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                        <Calendar className="w-3 h-3 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                        {race?.date || '--'}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-red-600/10 border border-red-600/20 text-red-700 dark:text-red-400 font-mono font-semibold">
                        {p.distance}
                      </span>
                      <span className="font-mono font-semibold text-[var(--text-primary)]">
                        #{p.bibNumber}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <span
                        className={`inline-flex text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                          isCompleted
                            ? 'bg-[var(--surface-inset)] text-[var(--text-secondary)] border-[var(--border-default)]'
                            : isRaceDay
                              ? 'text-red-700 dark:text-red-400 bg-red-500/10 border-red-500/25'
                              : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-600/25'
                        }`}
                      >
                        {raceStatus}
                      </span>
                      {!isCompleted && (
                        <span
                          className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded-full border ${
                            p.kitClaimedAt
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-600/25'
                              : 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/25'
                          }`}
                        >
                          {p.kitClaimedAt ? 'Kit Claimed' : 'Kit Desk Pending'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <span className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] group-hover:border-red-600/40 text-xs font-semibold text-[var(--text-primary)] transition-colors">
                  <span className="hidden sm:inline">{isCompleted ? 'Results' : 'Open Pass'}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ========== REGISTRATION ==========

interface RaceRegistrationFormProps {
  uid: string;
  friendIdentity?: { username?: string; displayName: string };
  runnerProfiles: RunnerProfile[];
  registeredRaceIds?: Set<string>;
  initialShirtSize?: string;
  initialRaceId?: string | null;
  requestedRaceId?: string | null;
  onRequestedRaceHandled?: () => void;
  onBrowseAllRaces?: () => void;
  onSaved?: () => void;
  onCancel?: () => void;
}

// Bib numbers are assigned by the system, not typed in: "5-001" is the first
// runner registered under the 5K Solo category, "5-002" the second, and so on.
// Uses a transaction against a per-distance counter doc (not a count() query)
// so two runners registering for the same distance at the same moment can't
// both land on the same sequence number and collide on one bib.
async function generateBibNumber(raceId: string, distanceLabel: string, km: number | null, entryCategory: RaceEntryCategory): Promise<string> {
  const counterId = `${raceId}_${distanceLabel}_${entryCategory}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const counterRef = doc(db, 'bibCounters', counterId);
  const sequence = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const next = (snap.exists() ? (snap.data().count as number) : 0) + 1;
    tx.set(counterRef, { count: next, raceId });
    return next;
  });
  const basePrefix = km !== null ? String(km) : 'CUSTOM';
  const suffix = entryCategory === 'duo' ? 'D' : entryCategory === 'trio' ? 'T' : entryCategory === 'group' ? 'G' : '';
  const prefix = suffix ? `${basePrefix}-${suffix}` : basePrefix;
  return `${prefix}-${String(sequence).padStart(3, '0')}`;
}

function RegistrationProgress({ currentStep, raceName }: { currentStep: 1 | 2 | 3; raceName?: string }) {
  const { can, authority } = useAccess();
  const steps = ['Choose race', 'Runner details', 'Confirmed'];
  return (
    <div className="border border-[var(--border-default)] rounded-2xl bg-[var(--surface-card)] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <span className="text-xs font-semibold font-display uppercase tracking-wider text-[var(--text-primary)] whitespace-nowrap">
          Registration Workflow
        </span>
        {raceName && (
          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md bg-[var(--surface-inset)] border border-[var(--border-default)] text-red-700 dark:text-red-400 truncate max-w-[220px]">
            {raceName}
          </span>
        )}
      </div>
      <ol className="grid grid-cols-3 gap-2 w-full sm:w-auto sm:min-w-[360px]" aria-label="Registration progress">
        {steps.map((label, index) => {
          const step = (index + 1) as 1 | 2 | 3;
          const complete = step < currentStep;
          const active = step === currentStep;
          return (
            <li
              key={label}
              className={`min-w-0 rounded-lg border px-2.5 py-1.5 text-center transition ${
                active
                  ? 'border-red-600 bg-red-600 text-white'
                  : complete
                    ? 'border-emerald-600/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-[var(--border-default)] bg-[var(--surface-inset)]/50 text-[var(--text-secondary)]'
              }`}
            >
              <span className="flex items-center justify-center gap-1.5 text-xs font-semibold whitespace-nowrap">
                {complete ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <span className="font-mono text-xs shrink-0">{step}.</span>
                )}
                <span className="hidden sm:inline truncate">{label}</span>
                <span className="sm:hidden">{step === 1 ? 'Race' : step === 2 ? 'Form' : 'Done'}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function RegistrationConfirmation({ race, registration, updated, onViewMyRace, onRegisterAnother }: {
  race?: Race;
  registration: RunnerProfile;
  updated: boolean;
  onViewMyRace: () => void;
  onRegisterAnother: () => void;
}) {
  const { can, authority } = useAccess();
  return (
    <div className="max-w-xl mx-auto space-y-5 animate-fadeIn">
      <RegistrationProgress currentStep={3} />
      <div className="glass-panel p-6 sm:p-8 text-center space-y-5 overflow-x-clip relative">
        <div className="absolute inset-x-0 top-0 h-1 rounded-t-2xl bg-gradient-to-r from-red-600 via-emerald-500 to-red-600" />
        <div className="w-14 h-14 rounded-full mx-auto bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="w-8 h-8" aria-hidden="true" />
        </div>
        <div>
          <h2 className="heading-float text-xl font-semibold font-display uppercase tracking-tight text-[var(--text-primary)]">{registration.paymentStatus === 'pending' ? 'Registration reserved' : 'You’re in!'}</h2>
          <p className={`text-xs font-semibold uppercase tracking-[0.18em] mt-1 ${registration.paymentStatus === 'pending' ? 'text-amber-800 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-400'}`}>{registration.paymentStatus === 'pending' ? 'Payment verification needed' : updated ? 'Registration updated' : 'Registration confirmed'}</p>
          <p className="text-xs text-[var(--text-secondary)] mt-2">{registration.paymentStatus === 'pending' ? 'Your bib is reserved. Follow the payment instructions below; the organizer will confirm payment before race day.' : 'Your race registration is saved under your account.'}</p>
        </div>
        {registration.paymentStatus === 'pending' && (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-left">
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-800 dark:text-amber-300">Manual payment instructions</p>
            <p className="text-xs text-[var(--text-primary)] whitespace-pre-line mt-1">{race?.manualPaymentInstructions || 'Please contact the race organizer to complete payment.'}</p>
            {race?.manualPaymentQrImage && <img src={race.manualPaymentQrImage} alt="GCash or QRPh payment code" className="mt-3 mx-auto w-44 max-w-full rounded-xl bg-white p-2" />}
          </div>
        )}
        <div className="glass-inset p-4 text-left grid grid-cols-2 gap-y-3 gap-x-4">
          <span><span className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Race</span><span className="block text-sm font-semibold text-[var(--text-primary)] mt-1 truncate">{race?.name || 'Race event'}</span></span>
          <span><span className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Race date</span><span className="block text-sm font-semibold text-[var(--text-primary)] mt-1">{race?.date || 'To be announced'}</span></span>
          <span><span className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Distance</span><span className="block text-sm font-semibold text-red-700 dark:text-red-400 mt-1">{registration.distance}</span></span>
          <span><span className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Bib number</span><span className="block text-lg font-mono font-semibold text-red-700 dark:text-red-400 mt-1">#{registration.bibNumber}</span></span>
          {registration.paymentStatus === 'pending' && registration.paymentReference && <span className="col-span-2"><span className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Payment reference</span><span className="block text-sm font-mono font-semibold text-amber-800 dark:text-amber-300 mt-1 break-all">{registration.paymentReference}</span></span>}
          {registration.shirtSize && <span><span className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Shirt size</span><span className="block text-sm font-semibold text-[var(--text-primary)] mt-1">{registration.shirtSize}</span></span>}
        </div>
        <p className="text-xs text-[var(--text-secondary)]">Your QR race pass and live race status will be available under My Races.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button type="button" onClick={onViewMyRace} className="min-h-11 py-3 px-4 rounded-[var(--radius-control)] font-display font-semibold uppercase text-xs tracking-widest text-white bg-gradient-to-r from-red-700 to-red-800 hover:from-red-600 hover:to-red-700 shadow-lg shadow-red-900/30 transition">View My Race Pass</button>
          <button type="button" onClick={onRegisterAnother} className="min-h-11 py-3 px-4 rounded-[var(--radius-control)] font-display font-semibold uppercase text-xs tracking-widest glass-inset text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 transition">Register another race</button>
        </div>
      </div>
    </div>
  );
}

function RaceRegistrationForm({ uid, friendIdentity, runnerProfiles, registeredRaceIds, initialShirtSize, initialRaceId, requestedRaceId, onRequestedRaceHandled, onBrowseAllRaces, onSaved, onCancel }: RaceRegistrationFormProps) {
  const { can, authority } = useAccess();
  const latest = mostRecent(runnerProfiles);
  const [races, setRaces] = useState<Race[]>([]);
  const [racesLoaded, setRacesLoaded] = useState(false);
  const [raceId, setRaceId] = useState(initialRaceId || '');
  const [showForm, setShowForm] = useState(false);
  const [deepLinkNotice, setDeepLinkNotice] = useState('');
  const [fullName, setFullName] = useState(latest?.fullName || '');
  const [distance, setDistance] = useState('Custom');
  const [customDistance, setCustomDistance] = useState('');
  const [entryCategory, setEntryCategory] = useState<RaceEntryCategory>('solo');
  const [teamName, setTeamName] = useState('');
  const [teamMembers, setTeamMembers] = useState<string[]>(['', '']);
  const [gender, setGender] = useState<Gender>(latest?.gender || 'male');
  const [age, setAge] = useState(latest?.age ? String(latest.age) : '');
  const [emergencyContactName, setEmergencyContactName] = useState(latest?.emergencyContactName || '');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState(latest?.emergencyContactPhone || '');
  const [shirtSize, setShirtSize] = useState(initialShirtSize || latest?.shirtSize || '');
  const [paymentReference, setPaymentReference] = useState('');
  const [parentalConsentConfirmed, setParentalConsentConfirmed] = useState(Boolean(latest?.parentalConsentConfirmed));
  const [parentGuardianName, setParentGuardianName] = useState(latest?.parentalGuardianName || '');
  const [parentGuardianRelationship, setParentGuardianRelationship] = useState(latest?.parentalGuardianRelationship || '');
  const [acceptedRegistrationTerms, setAcceptedRegistrationTerms] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [showInclusionImage, setShowInclusionImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{ registration: RunnerProfile; wasUpdate: boolean } | null>(null);
  const [paymentReturn, setPaymentReturn] = useState<PaymentStatusResponse | null>(null);
  const [checkingPayment, setCheckingPayment] = useState(false);

  useAndroidBackHandler(showInclusionImage, () => setShowInclusionImage(false));
  useAndroidBackHandler(showForm && !initialRaceId && !saving, () => {
    setConfirmation(null);
    setShowForm(false);
  });

  useEffect(() => {
    return subscribeSharedRaces((rawList, loaded, err) => {
      if (err) {
        console.warn('Races listener failed:', err);
        return;
      }
      if (!loaded) return;
      const list = [...rawList].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setRaces(list);
      setRacesLoaded(true);
    });
  }, []);

  // The payment-provider return URL is never treated as proof of payment.
  // It only tells us which server-side payment record to poll; the webhook is
  // still the only code path that creates a paid race registration.
  useEffect(() => {
    const paymentId = new URLSearchParams(window.location.search).get('payment');
    if (!paymentId) return;
    let cancelled = false;
    let timeout: number | undefined;
    const check = async () => {
      setCheckingPayment(true);
      try {
        const payment = await getPaymentStatus(paymentId);
        if (cancelled) return;
        setPaymentReturn(payment);
        setRaceId(payment.raceId);
        if (payment.status === 'paid') {
          window.history.replaceState({}, '', window.location.pathname);
          return;
        }
        if (payment.status === 'pending' || payment.status === 'creating') timeout = window.setTimeout(check, 2500);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'We could not verify your payment yet. Please refresh in a moment.');
      } finally {
        if (!cancelled) setCheckingPayment(false);
      }
    };
    void check();
    return () => {
      cancelled = true;
      if (timeout) window.clearTimeout(timeout);
    };
  }, []);

  const openRaces = races.filter((race) => isRaceRegistrationOpen(race));
  const selectedRace = openRaces.find((r) => r.id === raceId);
  const raceDistances = selectedRace?.distances || [];
  const availableEntryCategories: RaceEntryCategory[] = selectedRace ? raceEntryCategories(selectedRace) : ['solo'];
  const existingForRace = runnerProfiles.find((rp) => rp.raceId === raceId);

  useEffect(() => {
    if (!requestedRaceId || !racesLoaded) return;
    const isOpenMatch = openRaces.some((r) => r.id === requestedRaceId);
    if (isOpenMatch) {
      setRaceId(requestedRaceId);
      setShowForm(false);
      setDeepLinkNotice('');
    } else {
      const closedMatch = races.find((r) => r.id === requestedRaceId);
      setRaceId('');
      setShowForm(false);
      setDeepLinkNotice(
        closedMatch
          ? `Registration for "${closedMatch.name}" is currently closed. You can inspect its leaderboard in All Races or pick an open event below.`
          : 'That race link is not available or registration has closed. Choose an open event below.',
      );
    }
    setError('');
    onRequestedRaceHandled?.();
  }, [onRequestedRaceHandled, openRaces, races, racesLoaded, requestedRaceId]);

  // Already registered for this specific race? Load those details for editing.
  useEffect(() => {
    if (existingForRace) {
      setFullName(existingForRace.fullName);
      setGender(existingForRace.gender);
      setAge(String(existingForRace.age));
      setEmergencyContactName(existingForRace.emergencyContactName || '');
      setEmergencyContactPhone(existingForRace.emergencyContactPhone || '');
      setShirtSize(existingForRace.shirtSize || initialShirtSize || '');
      setEntryCategory(runnerEntryCategory(existingForRace));
      setTeamName(existingForRace.teamName || '');
      setTeamMembers(existingForRace.teamMembers || [existingForRace.fullName, '']);
      setParentalConsentConfirmed(Boolean(existingForRace.parentalConsentConfirmed));
      setParentGuardianName(existingForRace.parentalGuardianName || '');
      setParentGuardianRelationship(existingForRace.parentalGuardianRelationship || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId]);

  // Default to the race's first configured distance whenever the available list changes
  useEffect(() => {
    if (existingForRace) {
      setDistance(existingForRace.distance);
    } else if (raceDistances.length > 0 && !raceDistances.some((d) => d.label === distance)) {
      setDistance(raceDistances[0].label);
    } else if (raceDistances.length === 0 && distance !== 'Custom') {
      setDistance('Custom');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId, raceDistances.length]);

  useEffect(() => {
    if (!availableEntryCategories.includes(entryCategory)) setEntryCategory(availableEntryCategories[0] || 'solo');
  }, [availableEntryCategories, entryCategory]);

  const openLegalDoc = (legalDoc: LegalDocKey) => {
    window.dispatchEvent(new CustomEvent('racepulse:open-legal', { detail: legalDoc }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!can('personal.register')) return setError('Registration is disabled for your account.');
    setError('');
    if (!fullName.trim()) return setError('Please enter your full name.');
    if (!raceId) return setError('Please select which race you are registering for.');
    const parsedAge = parseInt(age, 10);
    if (!age || isNaN(parsedAge) || parsedAge < 1 || parsedAge > 120) return setError('Please enter a valid age.');
    if (parsedAge < 13) {
      if (!parentGuardianName.trim()) return setError('Enter the parent or legal guardian full name for participants under 13.');
      if (!parentGuardianRelationship.trim()) return setError('Specify the guardian relationship (e.g., Mother, Father, Legal Guardian).');
      if (!parentalConsentConfirmed) return setError('Verifiable parental or legal guardian consent is required for participants under 13.');
    }
    if (!emergencyContactName.trim()) return setError('Please enter an emergency contact person.');
    if (emergencyContactPhone.trim().length < 4) return setError('Please enter a valid emergency contact number.');
    if (!acceptedRegistrationTerms) {
      return setError('Please accept the Terms of Service, Privacy Policy, and Refund Policy before submitting.');
    }

    const termsAcceptedAt = existingForRace?.termsAcceptedAt || new Date().toISOString();
    setSaving(true);
    try {
      const finalDistance = distance === 'Custom' ? (customDistance || 'Custom Run') : distance;
      const memberCount = entryMemberCount[entryCategory];
      const normalizedMembers = entryCategory === 'solo'
        ? [fullName.trim()]
        : [fullName.trim(), ...teamMembers.slice(1, memberCount).map((member) => member.trim())];
      if (entryCategory !== 'solo' && !teamName.trim()) return setError('Please enter your team name.');
      if (normalizedMembers.some((member) => !member)) return setError(`Enter all ${memberCount} ${entryCategoryLabels[entryCategory]} member names.`);
      const selectedDistance = raceDistances.find((item) => item.label === distance);
      const shouldPayOnline = !existingForRace && !!selectedRace?.onlinePaymentEnabled && (selectedDistance?.price || 0) > 0;
      const shouldUseManualPayment = !existingForRace && !!selectedRace?.manualPaymentEnabled && (selectedDistance?.price || 0) > 0;
      if (shouldUseManualPayment && paymentReference.trim().length < 4) {
        return setError('Enter the payment reference number from your GCash or bank transaction.');
      }
      if (shouldPayOnline) {
        const checkout = await createPayMongoCheckout({
          raceId,
          distance: finalDistance,
          entryCategory,
          fullName: entryCategory === 'solo' ? fullName.trim().toUpperCase() : teamName.trim().toUpperCase(),
          gender,
          age: parsedAge,
          emergencyContactName: emergencyContactName.trim().toUpperCase(),
          emergencyContactPhone: emergencyContactPhone.trim(),
          ...(parsedAge < 13 ? {
            parentalConsentConfirmed: true,
            parentGuardianName: parentGuardianName.trim().toUpperCase(),
            parentGuardianRelationship: parentGuardianRelationship.trim().toUpperCase(),
          } : {}),
          termsAcceptedAt,
          marketingOptIn,
          ...(shirtSize ? { shirtSize } : {}),
          ...(entryCategory !== 'solo' ? { teamName: teamName.trim().toUpperCase(), teamMembers: normalizedMembers.map((member) => member.toUpperCase()) } : {}),
        });
        window.location.assign(checkout.checkoutUrl);
        return;
      }
      const selectedDistanceKm = raceDistances.find((d) => d.label === distance)?.km ?? null;
      const bibNumber = existingForRace ? existingForRace.bibNumber : await generateBibNumber(raceId, finalDistance, selectedDistanceKm, entryCategory);
      const record: RunnerProfile = {
        uid,
        raceId,
        fullName: entryCategory === 'solo' ? fullName.trim().toUpperCase() : teamName.trim().toUpperCase(),
        bibNumber,
        distance: finalDistance,
        entryCategory,
        gender,
        age: parsedAge,
        emergencyContactName: emergencyContactName.trim().toUpperCase(),
        emergencyContactPhone: emergencyContactPhone.trim(),
        createdAt: existingForRace?.createdAt || new Date().toISOString(),
        termsAcceptedAt,
        marketingOptIn,
        ...(parsedAge < 13 ? {
          parentalConsentConfirmed: true,
          parentalGuardianName: parentGuardianName.trim().toUpperCase(),
          parentalGuardianRelationship: parentGuardianRelationship.trim().toUpperCase(),
        } : {}),
        // A runner may correct their profile before race day, but that must
        // never erase operational records already set by the kit desk.
        ...(existingForRace?.chipId ? { chipId: existingForRace.chipId } : {}),
        ...(existingForRace?.kitClaimedAt ? { kitClaimedAt: existingForRace.kitClaimedAt } : {}),
        ...(shirtSize ? { shirtSize } : {}),
        ...(entryCategory !== 'solo' ? { teamName: teamName.trim().toUpperCase(), teamMembers: normalizedMembers.map((member) => member.toUpperCase()) } : {}),
        ...(shouldUseManualPayment ? {
          paymentStatus: 'pending' as const,
          paymentMethod: 'manual',
          paymentAmount: selectedDistance!.price,
          paymentReference: paymentReference.trim().toUpperCase(),
        } : {}),
      };
      if (existingForRace) {
        await setDoc(doc(db, 'runners', `${uid}_${raceId}`), record, { merge: true });
      } else {
        await setDoc(doc(db, 'runners', `${uid}_${raceId}`), record);
      }
      setConfirmation({ registration: record, wasUpdate: !!existingForRace });
    } catch (err: any) {
      setError(err.message || 'Failed to save your race profile.');
    } finally {
      setSaving(false);
    }
  };

  if (confirmation) {
    const confirmedRace = races.find((race) => race.id === confirmation.registration.raceId);
    return <RegistrationConfirmation
      race={confirmedRace}
      registration={confirmation.registration}
      updated={confirmation.wasUpdate}
      onViewMyRace={() => onSaved?.()}
      onRegisterAnother={() => { setConfirmation(null); setRaceId(''); setShowForm(false); setError(''); }}
    />;
  }

  if (paymentReturn?.status === 'paid') {
    return (
      <div className="max-w-xl mx-auto space-y-5 animate-fadeIn">
        <RegistrationProgress currentStep={3} />
        <div className="glass-panel p-7 text-center space-y-4">
          <div className="w-14 h-14 rounded-full mx-auto bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="w-8 h-8" aria-hidden="true" /></div>
          <div><h2 className="heading-float text-xl font-semibold font-display uppercase text-[var(--text-primary)]">Race registration confirmed</h2><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400 mt-1">Payment verified</p><p className="text-xs text-[var(--text-secondary)] mt-2">Your PayMongo payment was confirmed securely. Your race pass will appear in My Races.</p></div>
          <button type="button" onClick={() => onSaved?.()} className="min-h-11 w-full py-3 rounded-[var(--radius-control)] font-display font-semibold uppercase text-xs tracking-widest text-white bg-gradient-to-r from-red-700 to-red-800">View My Races</button>
        </div>
      </div>
    );
  }

  if (!raceId || !selectedRace) {
    return (
      <div className="space-y-4">
        <RegistrationProgress currentStep={1} />
        {deepLinkNotice && (
          <div role="alert" className="rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-xs font-semibold text-amber-900 dark:text-amber-300 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{deepLinkNotice}</span>
            </span>
            <button
              type="button"
              onClick={() => setDeepLinkNotice('')}
              aria-label="Dismiss registration notice"
              className="min-h-11 min-w-11 rounded-lg inline-flex items-center justify-center shrink-0 hover:bg-amber-500/15"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 py-2 text-xs font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 flex items-center gap-2 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Back to My Races
          </button>
        )}
        <RaceList
          races={openRaces}
          registeredRaceIds={registeredRaceIds}
          onSelectRace={(id) => { setRaceId(id); setShowForm(false); }}
          title="Register for a Race"
          subtitle="Browse open events - pick one to register, or reopen a race you're already in to update your details."
          actionLabel="View Race Details"
          emptyTitle="No races are open for registration yet"
          emptyDescription="Check back once an Admin or Organizer sets one up."
        />
      </div>
    );
  }

  if (!showForm) {
    return (
      <div className="max-w-6xl mx-auto space-y-5 animate-fadeIn">
        <RegistrationProgress currentStep={1} raceName={selectedRace.name} />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 glass-panel p-5 sm:p-6 space-y-5">
            <button
              type="button"
              onClick={() => setRaceId('')}
              className="min-h-10 py-1 text-xs font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 flex items-center gap-2 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Back to Race List
            </button>

            {selectedRace.posterImage && (
              <img src={selectedRace.posterImage} alt={`${selectedRace.name} event poster`} className="w-full aspect-video object-cover rounded-[18px] border border-[var(--border-subtle)]" />
            )}

            <div>
              <h2 className="heading-float text-xl sm:text-2xl font-semibold font-display uppercase tracking-tight text-[var(--text-primary)]">{selectedRace.name}</h2>
              <p className="text-xs font-mono text-[var(--text-secondary)] mt-1 flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" /> {selectedRace.date}
              </p>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)] mb-2 flex items-center gap-2">
                <Coins className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" /> Distances &amp; Pricing
              </h3>
              {(selectedRace.distances || []).length === 0 ? (
                <p className="text-xs text-[var(--text-secondary)]">Not set yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {selectedRace.distances.map((d) => (
                    <span key={d.id} className="text-xs font-semibold px-3 py-1 rounded-full bg-red-700/10 dark:bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 font-mono">
                      {d.label}{d.price > 0 && `: ₱${d.price.toFixed(0)}`}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {(selectedRace.inclusions || []).length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)] mb-2 flex items-center gap-2">
                  <PackageCheck className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" /> Inclusions
                </h3>
                <div className="flex flex-wrap gap-2">
                  {selectedRace.inclusions.map((incl, idx) => (
                    <span key={idx} className="text-xs font-semibold px-3 py-1 rounded-full glass-inset text-[var(--text-primary)]">{incl}</span>
                  ))}
                </div>
              </div>
            )}

            {selectedRace.inclusionImage && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)] mb-2 flex items-center gap-2">
                  <PackageCheck className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" /> Shirt / Kit Design
                </h3>
                <button type="button" onClick={() => setShowInclusionImage(true)} className="group relative w-full rounded-2xl overflow-clip border border-[var(--border-default)] bg-[var(--surface-inset)] text-left focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50">
                  <img src={selectedRace.inclusionImage} alt={`${selectedRace.name} shirt or kit design`} className="w-full max-h-96 object-contain" />
                  <span className="absolute right-3 bottom-3 inline-flex items-center gap-2 rounded-full bg-black/75 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition">
                    <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" /> Full screen
                  </span>
                </button>
              </div>
            )}

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)] mb-2 flex items-center gap-2">
                <CheckSquare className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" /> Checkpoints
              </h3>
              <p className="text-xs text-[var(--text-secondary)]">
                {[...(selectedRace.checkpoints || [])].sort((a, b) => a.order - b.order).map((c) => c.label).join(' → ') || 'Not set yet.'}
              </p>
            </div>
          </div>

          <div className="lg:col-span-5 glass-panel border-l-4 border-l-red-600 p-5 sm:p-6 space-y-4 lg:sticky lg:top-20">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-[var(--border-subtle)]">
              <h3 className="text-xs font-semibold font-display uppercase tracking-widest text-[var(--text-primary)]">
                Registration Action Dock
              </h3>
              <span
                className={`text-xs font-semibold uppercase px-2.5 py-0.5 rounded-full border ${
                  existingForRace
                    ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/25'
                    : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-600/25'
                }`}
              >
                {existingForRace ? `Bib #${existingForRace.bibNumber}` : 'Registration Open'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="glass-inset px-3 py-2.5">
                <span className="block text-[var(--text-secondary)]">Categories</span>
                <span className="font-mono font-semibold text-sm text-[var(--text-primary)] mt-0.5 block">
                  {(selectedRace.distances || []).length || 1} distance{((selectedRace.distances || []).length || 1) === 1 ? '' : 's'}
                </span>
              </div>
              <div className="glass-inset px-3 py-2.5">
                <span className="block text-[var(--text-secondary)]">Timing Splits</span>
                <span className="font-mono font-semibold text-sm text-[var(--text-primary)] mt-0.5 block">
                  {(selectedRace.checkpoints || []).length} checkpoint{(selectedRace.checkpoints || []).length === 1 ? '' : 's'}
                </span>
              </div>
            </div>

            {existingForRace && (
              <p className="text-xs text-amber-900 dark:text-amber-300 glass-inset px-3 py-2.5">
                You're already registered for this race under bib #{existingForRace.bibNumber}. Continuing lets you review or update your runner details.
              </p>
            )}

            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="min-h-11 w-full py-3 px-6 rounded-[var(--radius-control)] font-display font-semibold uppercase text-xs tracking-widest shadow-xl flex items-center justify-center gap-2 transition duration-200 text-white bg-gradient-to-r from-red-700 to-red-800 hover:from-red-600 hover:to-red-700 shadow-red-900/30"
            >
              <ArrowRight className="w-4 h-4" aria-hidden="true" /> {existingForRace ? 'Continue to Update Details' : 'Continue to Runner Details'}
            </button>

            {onBrowseAllRaces && (
              <button
                type="button"
                onClick={onBrowseAllRaces}
                className="min-h-10 w-full py-2.5 px-4 rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--surface-elevated)] hover:border-red-600/40 text-xs font-semibold text-[var(--text-primary)] flex items-center justify-center gap-2 transition"
              >
                <Trophy className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" /> Browse All Race Leaderboards
              </button>
            )}

            {friendIdentity?.username && <InviteFriendsToRace uid={uid} senderName={friendIdentity.displayName} race={selectedRace} />}
          </div>
        </div>

        {showInclusionImage && selectedRace?.inclusionImage && (
          <DialogSurface
            titleId="kit-design-preview-title"
            onRequestClose={() => setShowInclusionImage(false)}
            className="w-full max-w-4xl glass-panel p-4 sm:p-5 space-y-3"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 id="kit-design-preview-title" className="text-sm font-semibold text-[var(--text-primary)] truncate">
                {selectedRace.name} Shirt / Kit Design
              </h3>
              <button
                type="button"
                onClick={() => setShowInclusionImage(false)}
                className="min-h-11 min-w-11 rounded-full glass-inset text-[var(--text-primary)] hover:text-red-700 dark:hover:text-red-400 flex items-center justify-center transition"
                aria-label="Close full-screen image"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <img
              src={selectedRace.inclusionImage}
              alt={`${selectedRace.name} shirt or kit design`}
              className="block w-full max-h-[calc(100dvh-10rem)] object-contain rounded-xl bg-[var(--surface-inset)]"
            />
          </DialogSurface>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5 animate-fadeIn">
      <RegistrationProgress currentStep={2} raceName={selectedRace?.name} />
      <div className="glass-panel p-6 space-y-5">
        <button
          type="button"
          onClick={() => setShowForm(false)}
          className="min-h-11 py-2 text-xs font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 flex items-center gap-2 transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Back to Race Details
        </button>

        <div>
          <h2 className="heading-float text-lg font-semibold font-display uppercase tracking-tight text-[var(--text-primary)]">
            {existingForRace ? 'Update Registration for' : 'Register for'} {selectedRace?.name}
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-1">This links your account to your bib so organizers can record your checkpoint times.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4"><fieldset className="contents" disabled={!can('personal.register')} >
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Full Name</label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none" aria-hidden="true" />
              <input type="text" required value={fullName} onChange={(e) => setFullName(e.target.value.toUpperCase())}
                className="w-full min-h-11 glass-inset pl-10 pr-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50" placeholder="EX: JUAN DELA CRUZ" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Race Distance</label>
            {existingForRace ? (
              <div className="glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <MapPin className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" /> {existingForRace.distance}
              </div>
            ) : (
              <div className="relative">
                <MapPin className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none" aria-hidden="true" />
                <select value={distance} onChange={(e) => setDistance(e.target.value)}
                  className="w-full min-h-11 appearance-none glass-inset pl-10 pr-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50">
                  {raceDistances.map((d) => <option key={d.id} value={d.label}>{d.label}</option>)}
                  <option value="Custom">Custom Distance...</option>
                </select>
              </div>
            )}
            {!existingForRace && raceDistances.length === 0 && (
              <p className="text-xs text-[var(--text-secondary)] mt-2 pl-1">This race has no preset distances yet - enter your own below.</p>
            )}
          </div>

          {!existingForRace && distance === 'Custom' && (
            <input type="text" required value={customDistance} onChange={(e) => setCustomDistance(e.target.value.toUpperCase())}
              className="w-full min-h-11 glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50" placeholder="EX: 15K TRAIL RUN" />
          )}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Entry Category</label>
            {existingForRace ? (
              <div className="glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><Users2 className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" /> {entryCategoryLabels[runnerEntryCategory(existingForRace)]}</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {availableEntryCategories.map((category) => <button key={category} type="button" onClick={() => setEntryCategory(category)} className={`min-h-11 rounded-xl border px-3 py-2 text-xs font-semibold uppercase tracking-wide transition ${entryCategory === category ? 'border-red-700/45 dark:border-red-400/45 bg-red-700/10 dark:bg-red-500/10 text-red-700 dark:text-red-400' : 'border-[var(--border-default)] glass-inset text-[var(--text-secondary)]'}`}>{entryCategoryLabels[category]}</button>)}
              </div>
            )}
          </div>

          {entryCategory !== 'solo' && (
            <div className="glass-inset p-3 space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">{entryCategoryLabels[entryCategory]} Team Name</label>
                <input type="text" required value={teamName} onChange={(e) => setTeamName(e.target.value.toUpperCase())} className="w-full min-h-11 glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50" placeholder="EX: TEAM RACEPULSE" />
              </div>
              {Array.from({ length: entryMemberCount[entryCategory] }).map((_, index) => (
                <div key={index}>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Member {index + 1}{index === 0 ? ' / Team Captain' : ''}</label>
                  <input type="text" required value={index === 0 ? fullName : (teamMembers[index] || '')} onChange={(e) => {
                    const value = e.target.value.toUpperCase();
                    if (index === 0) setFullName(value);
                    else setTeamMembers((current) => { const next = [...current]; next[index] = value; return next; });
                  }} className="w-full min-h-11 glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50" placeholder={`FULL NAME OF MEMBER ${index + 1}`} />
                </div>
              ))}
              <p className="text-xs text-[var(--text-secondary)]">One shared bib and timing chip will be assigned to this team. Their result is ranked against other {entryCategoryLabels[entryCategory]} teams only.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="reg-gender" className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Gender</label>
              <select id="reg-gender" value={gender} onChange={(e) => setGender(e.target.value as Gender)}
                className="w-full min-h-11 appearance-none glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50">
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div>
              <label htmlFor="reg-age" className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Age</label>
              <input id="reg-age" type="number" required min={1} max={120} value={age} onChange={(e) => setAge(e.target.value)}
                className="w-full min-h-11 glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50" placeholder="EX: 27" />
            </div>
          </div>
          <p className="text-xs text-[var(--text-secondary)] -mt-2 pl-1">Used to place the athlete in the correct age category on race reports.</p>

          {age !== '' && !Number.isNaN(Number(age)) && Number(age) < 13 && (
            <div className="rounded-[var(--radius-control)] border border-amber-600/40 bg-amber-500/10 p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-300">
                <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" /> Verifiable Parental Consent (Under 13 / COPPA &amp; GDPR-K)
              </div>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                This participant is under 13 years old. A parent or legal guardian aged 18 or older must authorize this race entry and the publication of event timing records.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="reg-guardian-name" className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                    Parent / Legal Guardian Name <span className="text-red-700 dark:text-red-400">required</span>
                  </label>
                  <input
                    id="reg-guardian-name"
                    type="text"
                    required
                    maxLength={100}
                    value={parentGuardianName}
                    onChange={(e) => setParentGuardianName(e.target.value)}
                    placeholder="EX: MARIA DELA CRUZ"
                    className="w-full min-h-11 glass-inset px-4 py-2 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
                  />
                </div>
                <div>
                  <label htmlFor="reg-guardian-rel" className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                    Relationship <span className="text-red-700 dark:text-red-400">required</span>
                  </label>
                  <input
                    id="reg-guardian-rel"
                    type="text"
                    required
                    maxLength={40}
                    value={parentGuardianRelationship}
                    onChange={(e) => setParentGuardianRelationship(e.target.value)}
                    placeholder="Mother, Father, Guardian"
                    className="w-full min-h-11 glass-inset px-4 py-2 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
                  />
                </div>
              </div>
              <label htmlFor="reg-parental-consent" className="min-h-11 flex items-start gap-2 cursor-pointer pt-1">
                <input
                  id="reg-parental-consent"
                  type="checkbox"
                  checked={parentalConsentConfirmed}
                  onChange={(e) => setParentalConsentConfirmed(e.target.checked)}
                  className="rp-checkbox shrink-0"
                />
                <span className="text-xs text-[var(--text-primary)] leading-relaxed">
                  I certify that I am the parent or legal guardian (aged 18+) of this minor participant and grant verifiable parental consent for race participation, emergency contact use, and event timing under the Privacy Policy.
                </span>
              </label>
            </div>
          )}

          <div className="glass-inset p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]"><HeartPulse className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" /> Emergency Contact</div>
            <p className="text-xs text-[var(--text-secondary)] -mt-1">Collected strictly for race-day medical emergency response by authorized organizers.</p>
            <div>
              <label htmlFor="reg-emergency-name" className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Contact Person</label>
              <input id="reg-emergency-name" type="text" required value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value.toUpperCase())} maxLength={100} className="w-full min-h-11 glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50" placeholder="EX: MARIA DELA CRUZ (MOTHER)" />
            </div>
            <div>
              <label htmlFor="reg-emergency-phone" className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Contact Number</label>
              <div className="relative"><Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none" aria-hidden="true" /><input id="reg-emergency-phone" type="tel" required value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} maxLength={30} className="w-full min-h-11 glass-inset pl-10 pr-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50" placeholder="EX: 0917 123 4567" /></div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Shirt Size <span className="normal-case font-normal text-[var(--text-secondary)]">(optional unless included with race kit)</span></label>
            <ShirtSizePicker key={`${raceId}_${existingForRace?.shirtSize || initialShirtSize || ''}`} value={shirtSize} onChange={setShirtSize} emptyLabel="Select shirt size" />
            <p className="text-xs text-[var(--text-secondary)] mt-2 pl-1">Shared only with the kit desk for size allocation.</p>
          </div>

          <p className="text-xs text-[var(--text-secondary)] glass-inset px-3 py-2 flex items-center gap-2">
            <Hash className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
            {existingForRace
              ? `Your bib number stays #${existingForRace.bibNumber}.`
              : 'Your bib number is assigned automatically based on your distance (e.g. first 5K registrant gets "5-001").'}
          </p>

          {!existingForRace && (raceDistances.find((item) => item.label === distance)?.price || 0) > 0 && (() => {
            const entryFee = raceDistances.find((item) => item.label === distance)?.price || 0;
            const passedOnFee = selectedRace.onlinePaymentEnabled && selectedRace.paymentFeeMode === 'passed_on';
            return (
              <div className="glass-inset p-4 space-y-3 border border-[var(--border-default)]">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-2">
                  <Coins className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" /> Upfront Cost, Tax, and Cancellation Summary
                </h3>
                <dl className="space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-[var(--text-secondary)]">Entry fee ({distance})</dt>
                    <dd className="font-mono font-semibold text-[var(--text-primary)]">PHP {entryFee.toFixed(2)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-[var(--text-secondary)]">RacePulsePH platform surcharge</dt>
                    <dd className="font-semibold text-[var(--text-primary)]">PHP 0.00 (No hidden fees)</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-[var(--text-secondary)] shrink-0">Gateway processing &amp; taxes</dt>
                    <dd className="text-right text-[var(--text-secondary)]">
                      {selectedRace.onlinePaymentEnabled
                        ? passedOnFee
                          ? 'Applicable taxes included; PayMongo gateway fee itemized on checkout screen before final confirmation.'
                          : 'Applicable taxes and PayMongo gateway fee absorbed by organizer (PHP 0.00 surcharge).'
                        : 'No online gateway fee added (direct transfer per organizer instructions).'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-[var(--text-secondary)]">Billing schedule</dt>
                    <dd className="font-semibold text-[var(--text-primary)]">One-time charge (no subscription or auto-renewal)</dd>
                  </div>
                </dl>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed pt-1 border-t border-[var(--border-subtle)]">
                  Cancellation &amp; refunds: Full refund if organizer cancels. Runner cancellations follow our{' '}
                  <a
                    href="#legal-refund"
                    onClick={(event) => {
                      event.preventDefault();
                      openLegalDoc('refund');
                    }}
                    className="inline-flex items-center min-h-6 font-semibold text-red-700 dark:text-red-400 underline underline-offset-2"
                  >
                    Refund Policy
                  </a>
                  {' '}(100% at 14+ days before race day unless organizer terms state otherwise).
                </p>
              </div>
            );
          })()}

          {!existingForRace && selectedRace.onlinePaymentEnabled && (raceDistances.find((item) => item.label === distance)?.price || 0) > 0 && (
            <p className="text-xs text-emerald-800 dark:text-emerald-300 border border-emerald-500/30 bg-emerald-500/10 rounded-xl px-3 py-2 flex items-center gap-2"><Coins className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> Secure checkout: GCash, Maya, QRPh, or card. Your registration is confirmed only after payment verification.</p>
          )}
          {!existingForRace && selectedRace.manualPaymentEnabled && (raceDistances.find((item) => item.label === distance)?.price || 0) > 0 && (
            <div className="text-xs text-amber-900 dark:text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded-xl px-3 py-2">
              <p className="font-semibold">Manual payment &bull; PHP {(raceDistances.find((item) => item.label === distance)?.price || 0).toFixed(2)}</p>
              <p className="text-[var(--text-secondary)] whitespace-pre-line mt-1">{selectedRace.manualPaymentInstructions || 'Submit your registration, then follow the organizer payment instructions. Your bib will be reserved pending verification.'}</p>
              {selectedRace.manualPaymentQrImage && (
                <div className="mt-3 text-center">
                  <p className="text-xs font-semibold uppercase tracking-widest text-amber-900 dark:text-amber-300 mb-2">Scan to pay</p>
                  <img src={selectedRace.manualPaymentQrImage} alt="GCash or QRPh payment code" className="mx-auto w-48 max-w-full rounded-xl bg-white p-2 shadow-sm" />
                </div>
              )}
              <div className="mt-3">
                <label htmlFor="reg-payment-ref" className="block text-xs font-semibold uppercase tracking-widest text-amber-900 dark:text-amber-300 mb-2">Payment reference number <span className="text-red-700 dark:text-red-400">required</span></label>
                <input id="reg-payment-ref" type="text" required value={paymentReference} onChange={(event) => setPaymentReference(event.target.value.toUpperCase())} maxLength={100} autoCapitalize="characters" autoCorrect="off" placeholder="GCash / bank transaction reference" className="w-full min-h-11 glass-inset px-3 py-2 text-sm font-mono font-semibold tracking-wide text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-amber-500/50" />
                <p className="mt-2 text-xs text-[var(--text-secondary)]">Used solely to reconcile your transfer. A screenshot is not required.</p>
              </div>
            </div>
          )}

          {(checkingPayment || paymentReturn?.status === 'pending' || paymentReturn?.status === 'creating') && (
            <p className="text-xs text-amber-900 dark:text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded-xl px-3 py-2 flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 motion-safe:animate-spin shrink-0" aria-hidden="true" /> Verifying your PayMongo payment securely...</p>
          )}
          {(paymentReturn?.status === 'failed' || paymentReturn?.status === 'expired') && (
            <p role="alert" className="text-xs text-red-700 dark:text-red-400 border border-red-500/30 bg-red-500/10 rounded-xl px-3 py-2">Your checkout was not completed. No registration or charge was created; you may retry payment anytime.</p>
          )}

          <div className="glass-inset p-4 space-y-3 rounded-[var(--radius-control)]">
            <div className="flex items-start gap-2">
              <input
                id="reg-terms-consent"
                type="checkbox"
                checked={acceptedRegistrationTerms}
                onChange={(e) => setAcceptedRegistrationTerms(e.target.checked)}
                className="rp-checkbox shrink-0"
              />
              <div className="pt-2 text-xs text-[var(--text-primary)] leading-relaxed space-y-1">
                <label htmlFor="reg-terms-consent" className="cursor-pointer block">
                  I accept the Terms of Service, Privacy Policy, and Refund Policy for this event registration, including official timing and public leaderboard publication.
                </label>
                <p className="text-[var(--text-secondary)]">
                  Review:{' '}
                  <a href="#legal-terms" onClick={(e) => { e.preventDefault(); openLegalDoc('terms'); }} className="font-semibold underline underline-offset-2 text-red-700 dark:text-red-400">Terms of Service</a>
                  {', '}
                  <a href="#legal-privacy" onClick={(e) => { e.preventDefault(); openLegalDoc('privacy'); }} className="font-semibold underline underline-offset-2 text-red-700 dark:text-red-400">Privacy Policy</a>
                  {', and '}
                  <a href="#legal-refund" onClick={(e) => { e.preventDefault(); openLegalDoc('refund'); }} className="font-semibold underline underline-offset-2 text-red-700 dark:text-red-400">Refund Policy</a>.
                </p>
              </div>
            </div>
            <label htmlFor="reg-marketing-optin" className="min-h-11 flex items-start gap-2 cursor-pointer">
              <input
                id="reg-marketing-optin"
                type="checkbox"
                checked={marketingOptIn}
                onChange={(e) => setMarketingOptIn(e.target.checked)}
                className="rp-checkbox shrink-0"
              />
              <span className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Send me optional announcements about future runs and post-race certificates (optional, unsubscribe anytime).
              </span>
            </label>
          </div>

          {error && <p role="alert" className="text-xs text-red-700 dark:text-red-400 font-semibold flex items-start gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-1" aria-hidden="true" /> <span>{error}</span></p>}

          <button type="submit" disabled={saving}
            className="min-h-11 w-full py-3 px-6 rounded-[var(--radius-control)] font-display font-semibold uppercase text-xs tracking-widest shadow-xl flex items-center justify-center gap-2 transition duration-200 text-white bg-gradient-to-r from-red-700 to-red-800 hover:from-red-600 hover:to-red-700 shadow-red-900/30 disabled:opacity-60">
            {saving ? <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <ClipboardList className="w-4 h-4" aria-hidden="true" />} {existingForRace ? 'Update Registration' : selectedRace.onlinePaymentEnabled && (raceDistances.find((item) => item.label === distance)?.price || 0) > 0 ? `Continue to checkout (PHP ${(raceDistances.find((item) => item.label === distance)?.price || 0).toFixed(2)})` : selectedRace.manualPaymentEnabled && (raceDistances.find((item) => item.label === distance)?.price || 0) > 0 ? `Reserve slot (PHP ${(raceDistances.find((item) => item.label === distance)?.price || 0).toFixed(2)})` : 'Save Race Profile'}
          </button>
      </fieldset></form>
      </div>
    </div>
  );
}

// ========== SPLITS / RESULTS FOR ONE REGISTRATION ==========

interface RaceProgressStep {
  id: string;
  label: string;
  detail: string;
  completed: boolean;
  timestamp?: string;
}

function formatScanTime(timestamp?: string): string | undefined {
  return timestamp ? formatClockTime(timestamp) : undefined;
}

function RunnerRacePass({ race, runnerProfile, result, orderedCheckpoints }: {
  race: Race;
  runnerProfile: RunnerProfile;
  result: ReturnType<typeof computeResults>[number] | undefined;
  orderedCheckpoints: Race['checkpoints'];
}) {
  const { can, authority } = useAccess();
  const splitFor = (checkpointId?: string) => result?.splits.find((split) => split.checkpointId === checkpointId);
  const checkin = orderedCheckpoints.find((checkpoint, index) => checkpointType(checkpoint, index, orderedCheckpoints.length) === 'checkin');
  const start = orderedCheckpoints.find((checkpoint, index) => checkpointType(checkpoint, index, orderedCheckpoints.length) === 'start');
  const finish = orderedCheckpoints.find((checkpoint, index) => checkpointType(checkpoint, index, orderedCheckpoints.length) === 'finish');
  const checkinSplit = splitFor(checkin?.id);
  const startSplit = splitFor(start?.id);
  const finishSplit = splitFor(finish?.id);
  const hasOfficialResult = !!result?.finishTime && !!result.rank;
  const steps: RaceProgressStep[] = [
    { id: 'registered', label: 'Registered', detail: 'Your race slot is confirmed', completed: true, timestamp: runnerProfile.createdAt },
    { id: 'kit', label: 'Kit claimed', detail: runnerProfile.kitClaimedAt ? 'Race kit released to runner' : 'Claim from the race-kit desk', completed: !!runnerProfile.kitClaimedAt, timestamp: runnerProfile.kitClaimedAt },
    ...(checkin ? [{ id: 'checkin', label: 'Checked in', detail: checkin.label, completed: !!checkinSplit, timestamp: checkinSplit?.timestamp }] : []),
    ...(start ? [{
      id: 'start',
      label: 'Started',
      detail: result?.sequenceStartTime ? 'Started at previous entry finish' : startSplit ? start.label : result?.timingMethod === 'gun' ? 'Official Roll Call gun start' : start.label,
      completed: !!startSplit || !!result?.sequenceStartTime || result?.timingMethod === 'gun',
      timestamp: result?.sequenceStartTime || startSplit?.timestamp || (result?.timingMethod === 'gun' ? getWaveStartTime(race, runnerProfile.distance, runnerEntryCategory(runnerProfile)) : undefined),
    }] : []),
    ...(finish ? [{ id: 'finish', label: 'Finished', detail: finish.label, completed: !!finishSplit, timestamp: finishSplit?.timestamp }] : []),
    { id: 'result', label: 'Official result', detail: hasOfficialResult ? `Rank #${result!.rank} • ${formatRaceTime(result!.finishTime)}` : 'Available after your finish is recorded', completed: hasOfficialResult, timestamp: hasOfficialResult ? finishSplit?.timestamp : undefined },
  ];
  const currentStep = [...steps].reverse().find((step) => step.completed)?.label || 'Registered';

  return (
    <div className="lg:col-span-12 glass-panel overflow-x-clip animate-fadeIn">
      <div className="relative p-5 sm:p-6 overflow-clip rounded-t-2xl">
        {race.posterImage && <img src={race.posterImage} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover opacity-[0.12]" />}
        <div className="absolute inset-0 bg-gradient-to-r from-red-950/60 via-[var(--surface-card)]/90 to-[var(--surface-card)]" />
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="min-w-0">
            <h2 className="heading-float text-xl sm:text-2xl font-semibold font-display uppercase tracking-tight text-[var(--text-primary)] truncate">{race.name}</h2>
            <p className="text-xs text-[var(--text-secondary)] mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="inline-flex items-center gap-1 font-semibold uppercase tracking-widest text-red-700 dark:text-red-300 bg-red-700/10 border border-red-500/25 rounded-full px-3 py-1"><Radio className="w-3 h-3" aria-hidden="true" /> My Race Pass</span>
              <span className="inline-flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />{race.date}</span>
              <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />{runnerProfile.distance}</span>
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="glass-inset px-4 py-3 text-center min-w-[104px]">
              <span className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Bib number</span>
              <span className="block text-xl font-mono font-semibold tracking-wider text-red-700 dark:text-red-400 mt-1">#{runnerProfile.bibNumber}</span>
            </div>
            <div className="bg-white p-2 rounded-xl shadow-xl border border-[var(--border-default)]" title="Show this QR code at a race checkpoint">
              <QRCodeSVG value={`RPCHIPv1|${runnerProfile.raceId}|${runnerProfile.bibNumber}`} size={66} level="M" />
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6 border-t border-[var(--border-default)]">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-xs font-semibold font-display uppercase tracking-widest text-[var(--text-secondary)]">Race status</h3>
            <p className="text-xs text-[var(--text-primary)] font-semibold mt-1">Current: <span className="text-red-700 dark:text-red-400">{currentStep}</span></p>
          </div>
          {result?.finishTime && (
            <span className="text-xs font-mono font-semibold text-emerald-800 dark:text-emerald-300 border border-emerald-500/25 bg-emerald-500/10 rounded-full px-3 py-1">
              Official time <RaceTimeText value={result.finishTime} />
            </span>
          )}
        </div>
        <ol className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-2">
          {steps.map((step, index) => (
            <li key={step.id} className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${step.completed ? 'border-red-500/25 bg-red-500/5' : 'border-[var(--border-default)] bg-[var(--surface-inset)]/35'}`}>
              <span className={step.completed ? 'text-red-700 dark:text-red-400' : 'text-[var(--text-secondary)]'}>{step.completed ? <CheckCircle2 className="w-5 h-5" aria-hidden="true" /> : <Circle className="w-5 h-5" aria-hidden="true" />}</span>
              <span className="min-w-0"><span className="block text-xs font-semibold text-[var(--text-primary)]">{index + 1}. {step.label}</span><span className="block text-xs text-[var(--text-secondary)] truncate">{step.completed && step.timestamp ? formatScanTime(step.timestamp) : step.detail}</span></span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function DigitalRaceBib({ race, runnerProfile }: { race: Race; runnerProfile: RunnerProfile }) {
  const { can, authority } = useAccess();
  const bibRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const bibTemplate = resolveRaceBibTemplate(race, runnerProfile.distance, runnerProfile.entryCategory || 'solo');
  const layout = bibTemplate?.layout;
  const nameLines = raceBibNameLines(runnerProfile);
  const previewNameSize = Math.min(layout?.runnerNameSize ?? 5, 11 / Math.max(1, nameLines.length));

  useEffect(() => {
    void ensureRaceBibCustomFont(race.raceBibCustomFont).catch((error) => console.warn('Unable to load custom race bib font:', error));
  }, [race.raceBibCustomFont?.url]);

  const handleDownload = async () => {
    if (!bibTemplate || !layout) return;
    setDownloading(true);
    setDownloadError('');
    try {
      await ensureRaceBibCustomFont(race.raceBibCustomFont);
      await document.fonts?.ready;
      const canvas = document.createElement('canvas');
      let templateLoaded = false;
      try {
        const template = await loadDataImage(bibTemplate.image);
        canvas.width = template.naturalWidth;
        canvas.height = template.naturalHeight;
        const imgCtx = canvas.getContext('2d');
        if (!imgCtx) throw new Error('Canvas rendering is not supported by this browser.');
        imgCtx.drawImage(template, 0, 0, canvas.width, canvas.height);
        templateLoaded = true;
      } catch {
        canvas.width = 1200;
        canvas.height = 800;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas rendering is not supported by this browser.');
      if (!templateLoaded) {
        drawFallbackRaceBibCanvas(ctx, canvas.width, canvas.height, race, runnerProfile);
      }
      drawFittedRaceBibText(
        ctx, runnerProfile.bibNumber, canvas.width, canvas.height,
        layout.bibNumberX, layout.bibNumberY, layout.bibNumberSize ?? 12,
        layout.bibNumberColor ?? '#FFFFFF', layout.bibNumberStrokeColor ?? '#000000', layout.bibNumberStrokeWidth ?? 0, raceBibFontFamily(layout.bibNumberFont, race.raceBibCustomFont, true),
      );
      if (race.raceBibShowRaffleNumber) {
        drawFittedRaceBibText(
          ctx, runnerProfile.bibNumber, canvas.width, canvas.height,
          layout.raffleNumberX ?? 50, layout.raffleNumberY ?? 88, layout.raffleNumberSize ?? 7,
          layout.raffleNumberColor ?? '#FFFFFF', layout.raffleNumberStrokeColor ?? '#000000', layout.raffleNumberStrokeWidth ?? 0, raceBibFontFamily(layout.raffleNumberFont ?? 'mono', race.raceBibCustomFont, true),
        );
      }
      drawFittedRaceBibTextLines(
        ctx, nameLines, canvas.width, canvas.height,
        layout.runnerNameX, layout.runnerNameY, layout.runnerNameSize ?? 5,
        layout.runnerNameColor ?? '#FFFFFF', layout.runnerNameStrokeColor ?? '#000000', layout.runnerNameStrokeWidth ?? 0, raceBibFontFamily(layout.runnerNameFont, race.raceBibCustomFont, true),
      );
      const link = document.createElement('a');
      const safeRaceName = race.name.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'RacePulsePH';
      link.download = `${safeRaceName}_${runnerProfile.bibNumber}_Race-Bib.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.warn('Failed to download race bib:', err);
      setDownloadError('Could not prepare the bib image. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  if (!bibTemplate || !layout) return null;

  return (
    <div className="glass-panel p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2"><Hash className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" /> Your Digital Race Bib</h3>
          <p className="text-xs text-[var(--text-secondary)] mt-1">Your name and official bib number are ready for this race.</p>
        </div>
      </div>
      <div ref={bibRef} className="relative w-full aspect-[3/2] overflow-hidden rounded-xl bg-[var(--surface-inset)] select-none" style={{ containerType: 'inline-size' }}>
        <img src={bibTemplate.image} alt={`${race.name} personalized race bib`} className="absolute inset-0 w-full h-full object-cover" />
        <span className="absolute -translate-x-1/2 -translate-y-1/2 leading-none font-black tracking-tight drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)] whitespace-nowrap" style={{ left: `${layout.bibNumberX}%`, top: `${layout.bibNumberY}%`, fontSize: `${layout.bibNumberSize ?? 12}cqw`, color: layout.bibNumberColor ?? '#FFFFFF', fontFamily: raceBibFontFamily(layout.bibNumberFont, race.raceBibCustomFont), WebkitTextStroke: `${layout.bibNumberStrokeWidth ?? 0}cqw ${layout.bibNumberStrokeColor ?? '#000000'}`, paintOrder: 'stroke fill' }}>{runnerProfile.bibNumber}</span>
        {race.raceBibShowRaffleNumber && <span className="absolute -translate-x-1/2 -translate-y-1/2 leading-none font-black tracking-tight drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)] whitespace-nowrap" style={{ left: `${layout.raffleNumberX ?? 50}%`, top: `${layout.raffleNumberY ?? 88}%`, fontSize: `${layout.raffleNumberSize ?? 7}cqw`, color: layout.raffleNumberColor ?? '#FFFFFF', fontFamily: raceBibFontFamily(layout.raffleNumberFont ?? 'mono', race.raceBibCustomFont), WebkitTextStroke: `${layout.raffleNumberStrokeWidth ?? 0}cqw ${layout.raffleNumberStrokeColor ?? '#000000'}`, paintOrder: 'stroke fill' }}>{runnerProfile.bibNumber}</span>}
        <div className="absolute -translate-x-1/2 -translate-y-1/2 w-[90%] text-center leading-[1.16] font-black tracking-wide drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)]" style={{ left: `${layout.runnerNameX}%`, top: `${layout.runnerNameY}%`, fontSize: `${previewNameSize}cqw`, color: layout.runnerNameColor ?? '#FFFFFF', fontFamily: raceBibFontFamily(layout.runnerNameFont, race.raceBibCustomFont), WebkitTextStroke: `${layout.runnerNameStrokeWidth ?? 0}cqw ${layout.runnerNameStrokeColor ?? '#000000'}`, paintOrder: 'stroke fill' }}>{nameLines.map((name, index) => <span key={`${name}-${index}`} className="block">{name}</span>)}</div>
      </div>
      <button hidden={!can('personal.bibs')} type="button" onClick={handleDownload} disabled={downloading} className="min-h-11 w-full py-3 px-4 rounded-[var(--radius-control)] font-display font-semibold uppercase text-xs tracking-widest text-white bg-gradient-to-r from-red-700 to-red-800 hover:from-red-600 hover:to-red-700 shadow-lg shadow-red-900/30 transition disabled:opacity-60 flex items-center justify-center gap-2">
        {downloading ? <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <FileDown className="w-4 h-4" aria-hidden="true" />} {downloading ? 'Preparing Bib...' : 'Download Race Bib'}
      </button>
      {downloadError && <p role="alert" className="text-xs text-red-700 dark:text-red-400 text-center">{downloadError}</p>}
    </div>
  );
}

function RunnerSplitsView({ runnerProfile }: { runnerProfile: RunnerProfile }) {
  const { can, authority } = useAccess();
  const [race, setRace] = useState<Race | null | undefined>(undefined);
  const [chipReads, setChipReads] = useState<ChipRead[]>([]);
  const [officialEntry, setOfficialEntry] = useState<PublicLeaderboardEntry | null>(null);
  const [downloadingCert, setDownloadingCert] = useState(false);
  const [certError, setCertError] = useState('');

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'races', runnerProfile.raceId), (docSnap) => {
      setRace(docSnap.exists() ? (docSnap.data() as Race) : null);
    }, (err) => console.warn('Race listener failed:', err.message));
    return () => unsubscribe();
  }, [runnerProfile.raceId]);

  // Runner results come from the protected Firestore query only. The LAN timing
  // endpoint is intentionally reserved for race operators and must not send a
  // full on-site scan feed to every runner's browser.
  useEffect(() => {
    const unsubscribe = onSnapshot(query(
      collection(db, 'chipReads'),
      where('raceId', '==', runnerProfile.raceId),
      where('bibNumber', '==', runnerProfile.bibNumber)
    ), (snapshot) => {
      const list: ChipRead[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as ChipRead));
      setChipReads(list);
    }, (err) => {
      console.warn('Runner split listener failed:', err.message);
      setChipReads([]);
    });
    return () => unsubscribe();
  }, [runnerProfile.raceId, runnerProfile.bibNumber]);

  // The runner may read only their own raw splits. Their official placing must
  // instead come from the organizer-published public result document; ranking
  // a one-runner private query would incorrectly make every finisher #1.
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'liveResults', runnerProfile.raceId), (snapshot) => {
      const summary = snapshot.exists() ? (snapshot.data() as PublicLiveResults) : null;
      setOfficialEntry(summary?.officialResults?.find((entry) => entry.bibNumber === runnerProfile.bibNumber) || null);
    }, () => setOfficialEntry(null));
    return () => unsubscribe();
  }, [runnerProfile.raceId, runnerProfile.bibNumber]);

  const resultsArePublic = !!race?.completedAt || Object.keys(race?.waveStartTimes || {}).length > 0 || !!race?.gunStartTime;

  const localResult = useMemo(() => {
    if (!race) return null;
    return computeResults(race.checkpoints, chipReads, [runnerProfile], race.ageCategories || [], race).find((r) => r.bibNumber === runnerProfile.bibNumber);
  }, [race, chipReads, runnerProfile]);

  const result = useMemo(() => {
    // Keep the runner's own recorded finish visible while the organizer's
    // public summary is arriving. Once it arrives it replaces the local
    // placeholder with the real all-runner overall/category placement.
    if (!localResult || !officialEntry || !resultsArePublic) return localResult;
    return {
      ...localResult,
      finishTime: formatRaceTime(officialEntry.finishTime),
      finishReviewRequired: officialEntry.finishReviewRequired,
      chipTime: officialEntry.chipTime ? formatRaceTime(officialEntry.chipTime) : undefined,
      gunTime: officialEntry.gunTime ? formatRaceTime(officialEntry.gunTime) : undefined,
      sequenceStartTime: officialEntry.sequenceStartTime,
      rank: officialEntry.overallRank ?? officialEntry.rank,
      overallRank: officialEntry.overallRank ?? officialEntry.rank,
      categoryRank: officialEntry.categoryRank,
      categoryLabel: officialEntry.categoryLabel,
      timingMethod: officialEntry.timingMethod || localResult.timingMethod,
    };
  }, [localResult, officialEntry, resultsArePublic]);

  const orderedCheckpoints = useMemo(() => race ? [...race.checkpoints].sort((a, b) => a.order - b.order) : [], [race]);
  const hasFinished = Boolean(result?.finishTime);

  const handleDownloadCertificate = async () => {
    if (!race || !result) return;
    setDownloadingCert(true);
    setCertError('');
    try {
      await downloadFinisherCertificate(race, runnerProfile, result);
    } catch {
      setCertError('Could not prepare your E-Certificate PDF right now. Please try again.');
    } finally {
      setDownloadingCert(false);
    }
  };

  const splitsCard = (
    <div className="lg:col-span-7 space-y-6">
      <div className="glass-panel p-5">
        <h3 className="text-xs font-semibold font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" /> Checkpoint Splits
        </h3>
        {!race && <p className="text-xs text-[var(--text-secondary)]">Loading race details...</p>}
        {race && orderedCheckpoints.length === 0 && <p className="text-xs text-[var(--text-secondary)]">This race has no checkpoints configured yet.</p>}
        <div className="space-y-2">
          {orderedCheckpoints.map((cp, index) => {
            const split = result?.splits.find((s) => s.checkpointId === cp.id);
            const phase = checkpointType(cp, index, orderedCheckpoints.length);
            const waveStartTime = runnerProfile.startsAfterBib ? result?.sequenceStartTime
              : getWaveStartTime(race, runnerProfile.distance, runnerEntryCategory(runnerProfile));
            const cutoffDeadline = cp.cutoffMinutes && waveStartTime
              ? new Date(new Date(waveStartTime).getTime() + cp.cutoffMinutes * 60_000)
              : undefined;
            const afterCutoff = !!split && !!cutoffDeadline && new Date(split.timestamp).getTime() > cutoffDeadline.getTime();
            const usesGunFallback = phase === 'start' && !split && result?.timingMethod === 'gun' && !!waveStartTime;
            const usesSequenceStart = phase === 'start' && !!result?.sequenceStartTime;
            return (
              <div key={cp.id} className="flex items-center justify-between glass-inset px-4 py-3 gap-3">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--text-primary)]">{cp.label}</span>
                  <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)] mt-1">
                    {phase === 'checkin' ? 'Check-In' : phase === 'start' ? 'Official Start' : phase === 'finish' ? 'Finish' : cutoffDeadline ? `Cutoff ${formatClockTime(cutoffDeadline)}` : 'Split'}
                  </span>
                </span>
                <span className={`font-mono text-sm font-semibold shrink-0 text-right ${afterCutoff ? 'text-amber-800 dark:text-amber-300' : usesSequenceStart ? 'text-emerald-700 dark:text-emerald-400' : split ? 'text-red-700 dark:text-red-400' : usesGunFallback ? 'text-emerald-700 dark:text-emerald-400' : 'text-[var(--text-secondary)]'}`}>
                  {usesSequenceStart ? formatClockTime(result!.sequenceStartTime!) : split ? formatClockTime(split.timestamp) : usesGunFallback ? `Gun ${formatClockTime(waveStartTime!)}` : 'Pending'}
                  {usesSequenceStart && <span className="block text-xs font-sans uppercase tracking-wide">Previous entry finish</span>}
                  {afterCutoff && <span className="block text-xs font-sans uppercase tracking-wide">After cutoff</span>}
                  {usesGunFallback && <span className="block text-xs font-sans uppercase tracking-wide">Official fallback</span>}
                </span>
              </div>
            );
          })}
        </div>

        {result?.finishTime && (
          <div className="mt-4 bg-emerald-950/15 dark:bg-emerald-950/30 border border-emerald-700/35 p-4 rounded-2xl text-center">
            <p className="text-xs uppercase font-semibold tracking-widest text-emerald-700 dark:text-emerald-400">Finish Time</p>
            <p className="text-2xl font-mono font-semibold text-emerald-800 dark:text-emerald-300 mt-1">
              <RaceTimeText value={result.finishTime} />
            </p>
            {result.finishReviewRequired && <p className="text-amber-800 dark:text-amber-300 text-xs">Provisional place · Needs finish review</p>}
            {result.overallRank && <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">Overall #{result.overallRank} in {runnerDivisionLabel(runnerProfile)}{result.categoryRank ? ` · ${result.categoryLabel || 'Category'} #${result.categoryRank}` : ''}</p>}
            {race && (
              <button
                type="button"
                disabled={downloadingCert}
                hidden={!can('personal.certificates')}
                onClick={handleDownloadCertificate}
                className="mt-4 min-h-11 w-full sm:w-auto px-4 py-3 rounded-[var(--radius-control)] font-display font-semibold uppercase text-xs tracking-widest text-white bg-gradient-to-r from-red-700 to-red-800 hover:from-red-600 hover:to-red-700 shadow-lg shadow-red-900/30 disabled:opacity-60 transition inline-flex items-center justify-center gap-2"
              >
                {downloadingCert ? <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <FileDown className="w-4 h-4" aria-hidden="true" />}
                {downloadingCert ? 'Preparing E-Certificate...' : 'Download E-Certificate'}
              </button>
            )}
            {certError && (
              <p role="alert" className="mt-3 text-xs font-semibold text-red-700 dark:text-red-400 flex items-center justify-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{certError}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const passToolsCard = (
    <div className="lg:col-span-5 space-y-6">
      <div className="glass-panel p-5 text-center space-y-4">
        <h3 className="text-xs font-semibold font-display uppercase tracking-widest text-[var(--text-secondary)]">Your Checkpoint Bib QR</h3>
        <p className="text-xs text-[var(--text-secondary)]">Show this to organizers at each checkpoint to scan-and-record your time.</p>
        <div className="bg-white p-4 rounded-2xl inline-block shadow-xl border border-[var(--border-default)]">
          <QRCodeSVG value={`RPCHIPv1|${runnerProfile.raceId}|${runnerProfile.bibNumber}`} size={180} level="M" />
        </div>
        <div className="glass-inset p-3">
          <span className="text-xs font-mono text-[var(--text-secondary)] uppercase block tracking-wider mb-1">Bib Number</span>
          <span className="text-xl font-mono font-semibold text-red-700 dark:text-red-400 tracking-widest">#{runnerProfile.bibNumber}</span>
        </div>
      </div>
      {race && <DigitalRaceBib race={race} runnerProfile={runnerProfile} />}
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      {race && <RunnerRacePass race={race} runnerProfile={runnerProfile} result={result} orderedCheckpoints={orderedCheckpoints} />}
      {hasFinished ? (
        <>
          {splitsCard}
          {passToolsCard}
        </>
      ) : (
        <>
          {passToolsCard}
          {splitsCard}
        </>
      )}
    </div>
  );
}

// ========== PROFILE ==========

interface ProfileModalProps {
  profile: UserProfile;
  runnerProfiles: RunnerProfile[];
  onClose: () => void;
}

function ProfileModal({ profile, runnerProfiles, onClose }: ProfileModalProps) {
  return <AccountPrivacyModal profile={profile} runnerProfiles={runnerProfiles} onClose={onClose} />;
}
