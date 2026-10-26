import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, doc, getDoc, getDocs, onSnapshot, query, runTransaction, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db, signOutUser, updateAccountDisplayName } from '../firebase';
import { PasswordResetFlow } from './AccountSecurity';
import { checkpointType, computeResults, getWaveStartTime } from '../lib/timing';
import { downloadFinisherCertificate } from '../lib/finisherCertificate';
import { resizeImageToDataUrl } from '../lib/image';
import { ChipRead, FriendActivity, FriendProfile, Gender, PublicLeaderboardEntry, PublicLiveResults, Race, RaceEntryCategory, RunnerProfile, UserProfile } from '../types';
import CustomerForm from './CustomerForm';
import { QRCodeSVG } from 'qrcode.react';
import { LogOut, User, Hash, MapPin, RefreshCw, Award, ClipboardList, Clock, ArrowLeft, ArrowRight, Flag, Calendar, CheckSquare, Coins, PackageCheck, Camera, Trophy, X, Pencil, CheckCircle2, Circle, Radio, Phone, HeartPulse, Mail, FileDown, Maximize2, Users2, UserPlus, UserCheck } from 'lucide-react';
import BottomNav from './BottomNav';
import RaceList from './RaceList';
import { isRaceRegistrationOpen } from '../lib/raceRegistration';
import { entryCategoryLabels, entryMemberCount, raceEntryCategories, runnerDivisionLabel, runnerEntryCategory } from '../lib/raceEntry';
import { raceBibNameLines, resolveRaceBibTemplate } from '../lib/raceBib';
import { ensureRaceBibCustomFont, raceBibFontFamily } from '../lib/raceBibFont';
import RunnerReminderCenter from './RunnerReminderCenter';
import { createPayMongoCheckout, getPaymentStatus, PaymentStatusResponse } from '../lib/payments';
import DeleteAccountModal from './DeleteAccountModal';
import QrScannerModal from './QrScannerModal';

interface RunnerDashboardProps {
  profile: UserProfile;
  initialRaceId?: string | null;
  onInitialRaceHandled?: () => void;
}

type RunnerTab = 'events' | 'myraces' | 'friends' | 'engraving';

const standardShirtSizes = ['2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];
const usernamePattern = /^[a-z0-9][a-z0-9_.-]{2,23}$/;

function normalizedUsername(value: string): string {
  return value.trim().toLowerCase();
}

function ShirtSizePicker({ value, onChange, emptyLabel }: { value: string; onChange: (value: string) => void; emptyLabel: string }) {
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

function loadDataImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load the race bib template.'));
    image.src = source;
  });
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

function mostRecent(profiles: RunnerProfile[]): RunnerProfile | undefined {
  return [...profiles].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

export default function RunnerDashboard({ profile, initialRaceId, onInitialRaceHandled }: RunnerDashboardProps) {
  const [runnerProfiles, setRunnerProfiles] = useState<RunnerProfile[] | undefined>(undefined); // undefined = loading
  const [tab, setTab] = useState<RunnerTab>('events');
  const [showProfile, setShowProfile] = useState(false);
  const [showEventQrScanner, setShowEventQrScanner] = useState(false);
  const [scannedRaceId, setScannedRaceId] = useState<string | null>(null);
  const [eventQrMessage, setEventQrMessage] = useState('');
  const [eventQrError, setEventQrError] = useState('');

  useEffect(() => {
    const goHome = () => {
      setShowProfile(false);
      setTab('events');
    };
    window.addEventListener('racepulse:back', goHome);
    return () => window.removeEventListener('racepulse:back', goHome);
  }, []);

  useEffect(() => {
    if (initialRaceId) onInitialRaceHandled?.();
  }, [initialRaceId, onInitialRaceHandled]);

  useEffect(() => {
    const unsubscribe = onSnapshot(query(collection(db, 'runners'), where('uid', '==', profile.uid)), (snapshot) => {
      const list: RunnerProfile[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as RunnerProfile));
      setRunnerProfiles(list);
    }, (err) => {
      console.warn('Runner profiles listener failed:', err.message);
      setRunnerProfiles([]);
    });
    return () => unsubscribe();
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
    try {
      const url = new URL(text.trim());
      const allowedHosts = new Set(['racepulseph.com', 'www.racepulseph.com', 'racepulseph.web.app', 'racepulseph.firebaseapp.com', 'localhost']);
      const raceId = url.searchParams.get('register')?.trim();
      if (!allowedHosts.has(url.hostname) || !raceId || !/^[A-Za-z0-9_-]{1,64}$/.test(raceId)) {
        setEventQrError('This is not a valid RacePulse event registration QR code.');
        return false;
      }
      setEventQrError('');
      setEventQrMessage('Event found — opening its registration form…');
      setScannedRaceId(raceId);
      setTab('events');
      window.setTimeout(() => setShowEventQrScanner(false), 450);
      return true;
    } catch {
      setEventQrError('This is not a valid RacePulse event registration QR code.');
      return false;
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-4 pb-28 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between glass-panel hero-glow px-4 sm:px-6 py-5 gap-4 animate-fadeIn">
        <div>
          <span className="text-[10px] tracking-widest font-extrabold text-red-500 font-display bg-red-500/10 px-2.5 py-1 rounded-full uppercase border border-red-500/20">Runner Portal</span>
          <h1 className="heading-float text-2xl font-black tracking-tight font-display text-[var(--text-primary)] mt-1.5 uppercase">Welcome, {profile.displayName}</h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">Register for races, track your splits, and personalize your finisher medal.</p>
        </div>
        <div className="flex items-center gap-2 self-start">
          <button
            onClick={() => { setEventQrError(''); setEventQrMessage(''); setShowEventQrScanner(true); }}
            className="text-xs text-violet-500 border border-violet-500/30 hover:bg-violet-500/10 font-bold px-3.5 py-2 rounded-[20px] transition flex items-center gap-1.5 uppercase tracking-wider"
          >
            <Camera className="w-3.5 h-3.5" /> Scan event QR
          </button>
          <button
            onClick={() => setShowProfile(true)}
            title="My Profile"
            className="w-10 h-10 rounded-full overflow-hidden glass-inset flex items-center justify-center text-red-500 font-black text-sm hover:border-red-500/40 transition shrink-0"
          >
            {profile.photoURL ? (
              <img src={profile.photoURL} alt="" className="w-full h-full object-cover" />
            ) : (
              (profile.nickname || profile.displayName || '?').charAt(0).toUpperCase()
            )}
          </button>
          <button
            onClick={() => signOutUser()}
            className="text-xs text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--surface-inset)]/75 backdrop-blur-md hover:text-[var(--text-primary)] font-bold px-3.5 py-2 rounded-[20px] transition flex items-center gap-1.5 uppercase tracking-wider"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>
      </div>

      {showProfile && (
        <ProfileModal profile={profile} runnerProfiles={runnerProfiles || []} onClose={() => setShowProfile(false)} />
      )}

      {runnerProfiles === undefined && (
        <div className="glass-panel p-8 text-center">
          <RefreshCw className="w-6 h-6 text-[var(--text-muted)] animate-spin mx-auto" />
        </div>
      )}

      {runnerProfiles !== undefined && tab === 'events' && (
        <>
          <RunnerReminderCenter runnerProfiles={runnerProfiles} />
          <RaceRegistrationForm
            uid={profile.uid}
            friendIdentity={{ username: profile.username, displayName: profile.nickname || profile.displayName }}
            runnerProfiles={runnerProfiles}
            initialShirtSize={profile.shirtSize}
            initialRaceId={initialRaceId}
            requestedRaceId={scannedRaceId}
            onRequestedRaceHandled={() => setScannedRaceId(null)}
            onSaved={() => setTab('myraces')}
          />
        </>
      )}

      {runnerProfiles !== undefined && tab === 'myraces' && (
        <>
          <RunnerReminderCenter runnerProfiles={runnerProfiles} />
          <MyRacesView uid={profile.uid} runnerProfiles={runnerProfiles} onBrowseEvents={() => setTab('events')} />
        </>
      )}

      {runnerProfiles !== undefined && tab === 'friends' && (
        <FriendsView profile={profile} onOpenRace={(raceId) => { setScannedRaceId(raceId); setTab('events'); }} />
      )}

      {runnerProfiles !== undefined && tab === 'engraving' && (
        <CustomerForm
          onBackToRoleSelection={() => setTab('myraces')}
          backLabel="← Back to My Races"
          ownerUid={profile.uid}
          initialRunnerName={latestProfile?.fullName || ''}
          initialBibNumber={latestProfile?.bibNumber || ''}
        />
      )}

      {runnerProfiles !== undefined && (
        <BottomNav
          items={[
            { key: 'events', icon: <Flag className="w-4 h-4" />, label: 'Events', active: tab === 'events', onClick: () => setTab('events') },
            { key: 'myraces', icon: <ClipboardList className="w-4 h-4" />, label: 'My Races', active: tab === 'myraces', onClick: () => setTab('myraces') },
            { key: 'friends', icon: <Users2 className="w-4 h-4" />, label: 'Friends', active: tab === 'friends', onClick: () => setTab('friends') },
            { key: 'engraving', icon: <Award className="w-4 h-4" />, label: 'Engraving', active: tab === 'engraving', onClick: () => setTab('engraving') },
          ]}
        />
      )}
      {showEventQrScanner && (
        <QrScannerModal
          onClose={() => setShowEventQrScanner(false)}
          onScanSuccess={scanEventQr}
          successMessage={eventQrMessage}
          errorMessage={eventQrError}
          title="Scan Event QR"
          subtitle="OPEN A RACE REGISTRATION"
          instructions="Scan the RacePulse event QR from the organizer. We will open that specific race registration form for you."
        />
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
  const [races, setRaces] = useState<Race[]>([]);
  const [viewingProfile, setViewingProfile] = useState<RunnerProfile | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'races'), (snapshot) => {
      const list: Race[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as Race));
      setRaces(list);
    }, (err) => console.warn('Races listener failed:', err.message));
    return () => unsubscribe();
  }, []);

  if (viewingProfile) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setViewingProfile(null)}
          className="text-xs font-bold text-[var(--text-secondary)] hover:text-red-500 flex items-center gap-1.5 transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to My Races
        </button>
        <RunnerSplitsView runnerProfile={viewingProfile} />
      </div>
    );
  }

  const raceById = new Map(races.map((r) => [r.id, r]));
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcoming = runnerProfiles.filter((rp) => (raceById.get(rp.raceId)?.date || '9999') >= todayStr);
  const past = runnerProfiles.filter((rp) => (raceById.get(rp.raceId)?.date || '9999') < todayStr);

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBrowseEvents}
        className="w-full py-3.5 px-6 rounded-[var(--radius-control)] font-display font-black uppercase text-xs tracking-widest shadow-xl flex items-center justify-center gap-2 transition duration-200 text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-red-900/30"
      >
        <Flag className="w-4 h-4" /> Browse All Events
      </button>

      {runnerProfiles.length === 0 ? (
        <div className="glass-panel p-8 text-center space-y-2">
          <Flag className="w-8 h-8 text-[var(--text-muted)] mx-auto" />
          <p className="text-sm font-bold text-[var(--text-primary)]">You're not registered for any races yet</p>
          <p className="text-xs text-[var(--text-secondary)]">Tap "Browse All Events" above, or the Events tab below, to see what's on offer.</p>
        </div>
      ) : (
        <>
          <RaceProfileSection title="Upcoming Races" profiles={upcoming} raceById={raceById} onSelect={setViewingProfile} emptyText="No upcoming races." />
          <RaceProfileSection title="Past Races" profiles={past} raceById={raceById} onSelect={setViewingProfile} emptyText="No past races yet." />
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
  const [searchUsername, setSearchUsername] = useState('');
  const [searchResult, setSearchResult] = useState<FriendProfile | null>(null);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [activities, setActivities] = useState<Record<string, FriendActivity>>({});
  const [incoming, setIncoming] = useState<FriendRequestRecord[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestRecord[]>([]);
  const [invites, setInvites] = useState<RaceInviteRecord[]>([]);
  const [busy, setBusy] = useState(false);
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
    return <div className="glass-panel p-7 text-center space-y-2"><Users2 className="w-9 h-9 text-red-500 mx-auto" /><h2 className="text-base font-black text-[var(--text-primary)]">Choose a username first</h2><p className="text-xs text-[var(--text-secondary)]">Open your profile and save a unique username to use Friends. We use usernames so email addresses stay private.</p></div>;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5 animate-fadeIn">
      <div className="glass-panel p-5">
        <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-red-500/10 text-red-500"><Users2 className="w-5 h-5" /></span><div><h2 className="text-base font-black uppercase tracking-tight text-[var(--text-primary)]">Runner Friends</h2><p className="mt-1 text-xs text-[var(--text-secondary)]">Find a runner by username, then both of you must agree before profiles and recent races are shared.</p></div></div>
        <div className="mt-4 flex gap-2"><input value={searchUsername} onChange={(event) => setSearchUsername(event.target.value.toLowerCase())} onKeyDown={(event) => { if (event.key === 'Enter') void search(); }} placeholder="Search exact username, e.g. juan.runner" autoCapitalize="none" autoCorrect="off" maxLength={24} className="min-w-0 flex-1 glass-inset px-3 py-2.5 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" /><button type="button" onClick={() => void search()} disabled={busy} className="rounded-[12px] bg-red-600 px-4 text-[10px] font-black uppercase tracking-wide text-white disabled:opacity-60">Search</button></div>
        {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
        {notice && <p className="mt-3 text-xs text-emerald-500">{notice}</p>}
        {searchResult && <div className="mt-4 flex items-center justify-between gap-3 rounded-[16px] border border-[var(--border-default)] bg-[var(--surface-inset)]/50 p-3"><div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-red-500/10 font-black text-red-500">{searchResult.photoURL ? <img src={searchResult.photoURL} alt="" className="h-full w-full object-cover" /> : searchResult.displayName.charAt(0).toUpperCase()}</span><span className="min-w-0"><strong className="block truncate text-sm text-[var(--text-primary)]">{searchResult.nickname || searchResult.displayName}</strong><small className="block text-[11px] text-[var(--text-secondary)]">@{searchResult.username}</small></span></div><button type="button" onClick={() => void sendFriendRequest()} disabled={busy} className="shrink-0 rounded-[12px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-red-500 transition hover:bg-red-500 hover:text-white disabled:opacity-60"><UserPlus className="mr-1 inline h-3.5 w-3.5" /> Add</button></div>}
      </div>

      {invites.length > 0 && <div className="glass-panel p-5"><h3 className="text-[11px] font-black uppercase tracking-widest text-violet-500">Race invitations</h3><div className="mt-3 space-y-2">{invites.map((invite) => <div key={`${invite.fromUid}_${invite.raceId}`} className="flex items-center justify-between gap-3 rounded-[14px] border border-violet-500/20 bg-violet-500/5 p-3"><div><p className="text-xs font-bold text-[var(--text-primary)]">{invite.raceName}</p><p className="mt-0.5 text-[10.5px] text-[var(--text-secondary)]">Invited by {invite.fromDisplayName} • {invite.raceDate}</p></div><button type="button" onClick={() => void openInvite(invite)} className="shrink-0 rounded-[10px] bg-violet-600 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-white">View event</button></div>)}</div></div>}

      {incoming.length > 0 && <div className="glass-panel p-5"><h3 className="text-[11px] font-black uppercase tracking-widest text-amber-500">Friend requests</h3><div className="mt-3 space-y-2">{incoming.map((request) => <div key={`${request.fromUid}_${request.toUid}`} className="flex items-center justify-between gap-3 rounded-[14px] border border-[var(--border-default)] p-3"><div><p className="text-sm font-bold text-[var(--text-primary)]">{request.fromDisplayName}</p><p className="text-[10.5px] text-[var(--text-secondary)]">@{request.fromUsername} wants to connect.</p></div><div className="flex gap-1.5"><button type="button" onClick={() => void respondToRequest(request, false)} disabled={busy} className="rounded-[10px] glass-inset px-3 py-2 text-[10px] font-black uppercase tracking-wide text-[var(--text-secondary)]">Decline</button><button type="button" onClick={() => void respondToRequest(request, true)} disabled={busy} className="rounded-[10px] bg-emerald-600 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-white"><UserCheck className="mr-1 inline h-3.5 w-3.5" /> Accept</button></div></div>)}</div></div>}

      <div className="glass-panel p-5"><div className="flex items-center justify-between"><h3 className="text-[11px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Your friends</h3><span className="text-xs font-mono font-bold text-red-500">{friends.length}</span></div>{friends.length === 0 ? <p className="mt-3 text-xs text-[var(--text-secondary)]">No friends yet. Search their username above to send your first request.</p> : <div className="mt-3 space-y-3">{friends.map((friend) => { const activity = activities[friend.uid]; return <div key={friend.uid} className="rounded-[16px] border border-[var(--border-default)] bg-[var(--surface-inset)]/35 p-4"><div className="flex items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-red-500/10 font-black text-red-500">{friend.photoURL ? <img src={friend.photoURL} alt="" className="h-full w-full object-cover" /> : friend.displayName.charAt(0).toUpperCase()}</span><div className="min-w-0"><p className="truncate text-sm font-black text-[var(--text-primary)]">{friend.nickname || friend.displayName}</p><p className="text-[10.5px] text-[var(--text-secondary)]">@{friend.username}</p></div></div><div className="mt-3 border-t border-[var(--border-subtle)] pt-3"><p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Recent races</p>{activity?.recentRaces?.length ? <div className="mt-2 space-y-1.5">{activity.recentRaces.slice(0, 3).map((race) => <p key={`${race.raceId}_${race.distance}`} className="text-xs text-[var(--text-secondary)]"><strong className="text-[var(--text-primary)]">{race.raceName}</strong> <span className="text-red-500">• {race.distance}</span> <span className="text-[var(--text-muted)]">• {race.date}</span></p>)}</div> : <p className="mt-1 text-xs text-[var(--text-muted)]">No shared race activity yet.</p>}</div></div>; })}</div>}</div>
    </div>
  );
}

function InviteFriendsToRace({ uid, senderName, race }: { uid: string; senderName: string; race: Race }) {
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
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black text-[var(--text-primary)]">Running with friends?</p><p className="mt-0.5 text-[10.5px] text-[var(--text-secondary)]">Send this event straight to an accepted RacePulse friend.</p></div><button type="button" onClick={() => { setOpen((value) => !value); setMessage(''); }} className="rounded-[12px] border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-violet-500 transition hover:bg-violet-600 hover:text-white"><UserPlus className="mr-1 inline h-3.5 w-3.5" /> Invite friends</button></div>
      {open && <div className="mt-3 border-t border-violet-500/15 pt-3"><p className="text-[9px] font-black uppercase tracking-widest text-violet-500">Choose friend</p>{friends.length === 0 ? <p className="mt-2 text-xs text-[var(--text-secondary)]">No accepted friends yet. Add friends first from the Friends tab.</p> : <div className="mt-2 space-y-1.5">{friends.map((friend) => <div key={friend.uid} className="flex items-center justify-between gap-2 rounded-[12px] bg-black/10 px-3 py-2"><span className="min-w-0"><strong className="block truncate text-xs text-[var(--text-primary)]">{friend.nickname || friend.displayName}</strong><small className="text-[10px] text-[var(--text-secondary)]">@{friend.username}</small></span><button type="button" onClick={() => void invite(friend)} disabled={sendingTo === friend.uid} className="rounded-lg bg-violet-600 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wide text-white disabled:opacity-60">{sendingTo === friend.uid ? 'Sending…' : 'Invite'}</button></div>)}</div>}{message && <p className={`mt-2 text-[10.5px] ${message.startsWith('Invite sent') ? 'text-emerald-500' : 'text-red-500'}`}>{message}</p>}</div>}
    </div>
  );
}

function RaceProfileSection({
  title,
  profiles,
  raceById,
  onSelect,
  emptyText,
}: {
  title: string;
  profiles: RunnerProfile[];
  raceById: Map<string, Race>;
  onSelect: (p: RunnerProfile) => void;
  emptyText: string;
}) {
  return (
    <div className="glass-panel p-5">
      <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] mb-3">{title}</h3>
      {profiles.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {profiles.map((p) => {
            const race = raceById.get(p.raceId);
            const today = new Date().toISOString().slice(0, 10);
            const raceStatus = !race
              ? 'Registration saved'
              : race.completedAt || race.date < today
                ? 'Race completed'
                : race.date === today
                  ? 'Race day'
                  : 'Upcoming';
            return (
              <button
                key={p.raceId}
                onClick={() => onSelect(p)}
                className="w-full flex items-center justify-between glass-inset px-4 py-3 text-left hover:border-red-500/40 transition"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--text-primary)] truncate">{race?.name || 'Unknown Race'}</p>
                  <p className="text-[10px] text-[var(--text-secondary)] flex items-center gap-1.5 mt-0.5">
                    <Calendar className="w-3 h-3 text-red-500" /> {race?.date || '—'} &bull; {p.distance} &bull; #{p.bibNumber}
                  </p>
                  <span className={`inline-flex mt-2 text-[9px] font-black uppercase tracking-wide px-2 py-1 rounded-full border ${
                    raceStatus === 'Race completed'
                      ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'
                      : raceStatus === 'Race day'
                        ? 'text-red-500 bg-red-500/10 border-red-500/20'
                        : 'text-[var(--text-secondary)] bg-[var(--surface-hover)] border-[var(--border-default)]'
                  }`}>{raceStatus}</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
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
  initialShirtSize?: string;
  initialRaceId?: string | null;
  requestedRaceId?: string | null;
  onRequestedRaceHandled?: () => void;
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
    tx.set(counterRef, { count: next });
    return next;
  });
  const basePrefix = km !== null ? String(km) : 'CUSTOM';
  const suffix = entryCategory === 'duo' ? 'D' : entryCategory === 'trio' ? 'T' : entryCategory === 'group' ? 'G' : '';
  const prefix = suffix ? `${basePrefix}-${suffix}` : basePrefix;
  return `${prefix}-${String(sequence).padStart(3, '0')}`;
}

function RegistrationProgress({ currentStep }: { currentStep: 1 | 2 | 3 }) {
  const steps = ['Choose race', 'Runner details', 'Confirmed'];
  return (
    <ol className="grid grid-cols-3 gap-1.5 max-w-xl mx-auto" aria-label="Registration progress">
      {steps.map((label, index) => {
        const step = (index + 1) as 1 | 2 | 3;
        const complete = step < currentStep;
        const active = step === currentStep;
        return (
          <li key={label} className={`rounded-xl border px-2 py-2 text-center transition ${complete || active ? 'border-red-500/30 bg-red-500/10 text-red-500' : 'border-[var(--border-default)] bg-[var(--surface-inset)]/40 text-[var(--text-muted)]'}`}>
            <span className="flex items-center justify-center gap-1.5 text-[9px] sm:text-[10px] font-black uppercase tracking-wide">
              {complete ? <CheckCircle2 className="w-3.5 h-3.5" /> : <span className={`w-4 h-4 rounded-full border flex items-center justify-center text-[8px] ${active ? 'border-red-500' : 'border-current'}`}>{step}</span>}
              <span className="hidden sm:inline">{label}</span><span className="sm:hidden">{step === 1 ? 'Race' : step === 2 ? 'Details' : 'Done'}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function RegistrationConfirmation({ race, registration, updated, onViewMyRace, onRegisterAnother }: {
  race?: Race;
  registration: RunnerProfile;
  updated: boolean;
  onViewMyRace: () => void;
  onRegisterAnother: () => void;
}) {
  return (
    <div className="max-w-xl mx-auto space-y-5 animate-fadeIn">
      <RegistrationProgress currentStep={3} />
      <div className="glass-panel p-7 text-center space-y-5 overflow-hidden relative">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-red-600 via-emerald-500 to-red-600" />
        <div className="w-14 h-14 rounded-full mx-auto bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-500">
          <CheckCircle2 className="w-8 h-8" />
        </div>
        <div>
          <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${registration.paymentStatus === 'pending' ? 'text-amber-500' : 'text-emerald-500'}`}>{registration.paymentStatus === 'pending' ? 'Payment verification needed' : updated ? 'Registration updated' : 'Registration confirmed'}</p>
          <h2 className="heading-float text-xl font-black font-display uppercase tracking-tight text-[var(--text-primary)] mt-2">{registration.paymentStatus === 'pending' ? 'Registration reserved' : 'You’re in!'}</h2>
          <p className="text-xs text-[var(--text-secondary)] mt-2">{registration.paymentStatus === 'pending' ? 'Your bib is reserved. Follow the payment instructions below; the organizer will confirm payment before race day.' : 'Your race registration is saved under your account.'}</p>
        </div>
        {registration.paymentStatus === 'pending' && (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-left">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">Manual payment instructions</p>
            <p className="text-xs text-[var(--text-primary)] whitespace-pre-line mt-1.5">{race?.manualPaymentInstructions || 'Please contact the race organizer to complete payment.'}</p>
            {race?.manualPaymentQrImage && <img src={race.manualPaymentQrImage} alt="GCash or QRPh payment code" className="mt-3 mx-auto w-44 max-w-full rounded-xl bg-white p-2" />}
          </div>
        )}
        <div className="glass-inset p-4 text-left grid grid-cols-2 gap-y-3 gap-x-4">
          <span><span className="block text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Race</span><span className="block text-sm font-bold text-[var(--text-primary)] mt-0.5 truncate">{race?.name || 'Race event'}</span></span>
          <span><span className="block text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Race date</span><span className="block text-sm font-bold text-[var(--text-primary)] mt-0.5">{race?.date || 'To be announced'}</span></span>
          <span><span className="block text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Distance</span><span className="block text-sm font-bold text-red-500 mt-0.5">{registration.distance}</span></span>
          <span><span className="block text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Bib number</span><span className="block text-lg font-mono font-black text-red-500 mt-0.5">#{registration.bibNumber}</span></span>
          {registration.paymentStatus === 'pending' && registration.paymentReference && <span className="col-span-2"><span className="block text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Payment reference</span><span className="block text-sm font-mono font-bold text-amber-500 mt-0.5 break-all">{registration.paymentReference}</span></span>}
          {registration.shirtSize && <span><span className="block text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Shirt size</span><span className="block text-sm font-bold text-[var(--text-primary)] mt-0.5">{registration.shirtSize}</span></span>}
        </div>
        <p className="text-[10.5px] text-[var(--text-secondary)]">Your QR race pass and live race status will be available under My Races.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button type="button" onClick={onViewMyRace} className="py-3 px-4 rounded-[var(--radius-control)] font-display font-black uppercase text-[10px] tracking-widest text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-lg shadow-red-900/30 transition">View My Race Pass</button>
          <button type="button" onClick={onRegisterAnother} className="py-3 px-4 rounded-[var(--radius-control)] font-display font-black uppercase text-[10px] tracking-widest glass-inset text-[var(--text-secondary)] hover:text-red-500 transition">Register another race</button>
        </div>
      </div>
    </div>
  );
}

function RaceRegistrationForm({ uid, friendIdentity, runnerProfiles, initialShirtSize, initialRaceId, requestedRaceId, onRequestedRaceHandled, onSaved, onCancel }: RaceRegistrationFormProps) {
  const latest = mostRecent(runnerProfiles);
  const [races, setRaces] = useState<Race[]>([]);
  const [raceId, setRaceId] = useState(initialRaceId || '');
  // A per-event public QR brings a runner directly here. Keep the normal
  // browse-first screen for dashboard navigation, but skip it for that link.
  const [showForm, setShowForm] = useState(() => !!initialRaceId);
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
  const [showInclusionImage, setShowInclusionImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{ registration: RunnerProfile; wasUpdate: boolean } | null>(null);
  const [paymentReturn, setPaymentReturn] = useState<PaymentStatusResponse | null>(null);
  const [checkingPayment, setCheckingPayment] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'races'), (snapshot) => {
      const list: Race[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as Race));
      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setRaces(list);
    }, (err) => console.warn('Races listener failed:', err.message));
    return () => unsubscribe();
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
    if (!requestedRaceId) return;
    setRaceId(requestedRaceId);
    setShowForm(true);
    setError('');
    onRequestedRaceHandled?.();
  }, [onRequestedRaceHandled, requestedRaceId]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!fullName.trim()) return setError('Please enter your full name.');
    if (!raceId) return setError('Please select which race you are registering for.');
    const parsedAge = parseInt(age, 10);
    if (!age || isNaN(parsedAge) || parsedAge < 1 || parsedAge > 120) return setError('Please enter a valid age.');
    if (!emergencyContactName.trim()) return setError('Please enter an emergency contact person.');
    if (emergencyContactPhone.trim().length < 4) return setError('Please enter a valid emergency contact number.');

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
          <div className="w-14 h-14 rounded-full mx-auto bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-500"><CheckCircle2 className="w-8 h-8" /></div>
          <div><p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-500">Payment verified</p><h2 className="heading-float text-xl font-black font-display uppercase text-[var(--text-primary)] mt-2">Race registration confirmed</h2><p className="text-xs text-[var(--text-secondary)] mt-2">Your PayMongo payment was confirmed securely. Your race pass will appear in My Races.</p></div>
          <button type="button" onClick={() => onSaved?.()} className="w-full py-3.5 rounded-[var(--radius-control)] font-display font-black uppercase text-xs tracking-widest text-white bg-gradient-to-r from-red-600 to-red-700">View My Races</button>
        </div>
      </div>
    );
  }

  if (!raceId || !selectedRace) {
    return (
      <div className="space-y-4">
        <RegistrationProgress currentStep={1} />
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-bold text-[var(--text-secondary)] hover:text-red-500 flex items-center gap-1.5 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to My Races
          </button>
        )}
        <RaceList
          races={openRaces}
          onSelectRace={(id) => { setRaceId(id); setShowForm(false); }}
          title="Register for a Race"
          subtitle="Browse what's on offer - pick one to register, or reopen a race you're already in to update your details."
          actionLabel="View Race Details"
          emptyTitle="No races are open for registration yet"
          emptyDescription="Check back once an Admin or Organizer sets one up."
        />
      </div>
    );
  }

  if (!showForm) {
    return (
      <div className="max-w-2xl mx-auto glass-panel p-6 space-y-5 animate-fadeIn">
        <RegistrationProgress currentStep={1} />
        <button
          type="button"
          onClick={() => setRaceId('')}
          className="text-xs font-bold text-[var(--text-secondary)] hover:text-red-500 flex items-center gap-1.5 transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Race List
        </button>

        {selectedRace?.posterImage && (
          <img src={selectedRace.posterImage} alt="" className="w-full aspect-video object-cover rounded-[18px] -mt-1" />
        )}

        <div>
          <h2 className="heading-float text-xl font-black font-display uppercase tracking-tight text-[var(--text-primary)]">{selectedRace?.name}</h2>
          <p className="text-xs text-[var(--text-secondary)] mt-1 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-red-500" /> {selectedRace?.date}
          </p>
        </div>

        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-2 flex items-center gap-1.5"><Coins className="w-3.5 h-3.5 text-red-500" /> Distances &amp; Pricing</h3>
          {(selectedRace?.distances || []).length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">Not set yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {selectedRace!.distances.map((d) => (
                <span key={d.id} className="text-xs font-bold px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-500">
                  {d.label}{d.price > 0 && ` — ₱${d.price.toFixed(0)}`}
                </span>
              ))}
            </div>
          )}
        </div>

        {(selectedRace?.inclusions || []).length > 0 && (
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-2 flex items-center gap-1.5"><PackageCheck className="w-3.5 h-3.5 text-red-500" /> Inclusions</h3>
            <div className="flex flex-wrap gap-2">
              {selectedRace!.inclusions.map((incl, idx) => (
                <span key={idx} className="text-xs font-semibold px-3 py-1.5 rounded-full glass-inset text-[var(--text-primary)]">{incl}</span>
              ))}
            </div>
          </div>
        )}

        {selectedRace?.inclusionImage && (
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-2 flex items-center gap-1.5"><PackageCheck className="w-3.5 h-3.5 text-red-500" /> Shirt / Kit Design</h3>
            <button type="button" onClick={() => setShowInclusionImage(true)} className="group relative w-full rounded-[16px] overflow-hidden border border-[var(--border-default)] bg-[var(--surface-inset)] text-left focus:outline-none focus:ring-2 focus:ring-red-500/50">
              <img src={selectedRace.inclusionImage} alt={`${selectedRace.name} shirt or kit design`} className="w-full max-h-96 object-contain" />
              <span className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition"><Maximize2 className="w-3.5 h-3.5" /> Full screen</span>
            </button>
          </div>
        )}

        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-2 flex items-center gap-1.5"><CheckSquare className="w-3.5 h-3.5 text-red-500" /> Checkpoints</h3>
          <p className="text-xs text-[var(--text-secondary)]">
            {[...(selectedRace?.checkpoints || [])].sort((a, b) => a.order - b.order).map((c) => c.label).join(' → ') || 'Not set yet.'}
          </p>
        </div>

        {existingForRace && (
          <p className="text-[10.5px] text-amber-500 glass-inset px-3 py-2">You're already registered for this race under bib #{existingForRace.bibNumber}. Continuing will let you update your details.</p>
        )}

        {friendIdentity?.username && <InviteFriendsToRace uid={uid} senderName={friendIdentity.displayName} race={selectedRace} />}

        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="w-full py-3.5 px-6 rounded-[var(--radius-control)] font-display font-black uppercase text-xs tracking-widest shadow-xl flex items-center justify-center gap-2 transition duration-200 text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-red-900/30"
        >
          <ArrowRight className="w-4 h-4" /> {existingForRace ? 'Continue to Update Details' : 'Continue to Runner Details'}
        </button>

        {showInclusionImage && selectedRace?.inclusionImage && createPortal(
          <div className="fixed inset-0 z-[1000] bg-black/90 backdrop-blur-sm p-4 sm:p-8 flex items-center justify-center animate-fadeIn" role="dialog" aria-modal="true" aria-label="Shirt or kit design preview" onClick={() => setShowInclusionImage(false)}>
            <div className="relative max-w-6xl max-h-full" onClick={(e) => e.stopPropagation()}>
              <img src={selectedRace.inclusionImage} alt={`${selectedRace.name} shirt or kit design`} className="block max-w-full max-h-[calc(100vh-4rem)] object-contain rounded-xl shadow-2xl" />
              <button type="button" onClick={() => setShowInclusionImage(false)} className="absolute -top-3 -right-3 w-10 h-10 rounded-full bg-white text-zinc-950 hover:bg-red-500 hover:text-white shadow-xl flex items-center justify-center transition" aria-label="Close full-screen image"><X className="w-5 h-5" /></button>
            </div>
          </div>,
          document.body,
        )}
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto glass-panel p-6 space-y-5 animate-fadeIn">
      <RegistrationProgress currentStep={2} />
      <button
        type="button"
        onClick={() => setShowForm(false)}
        className="text-xs font-bold text-[var(--text-secondary)] hover:text-red-500 flex items-center gap-1.5 transition"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Race Details
      </button>

      <div>
        <h2 className="heading-float text-lg font-black font-display uppercase tracking-tight text-[var(--text-primary)]">
          {existingForRace ? 'Update Registration for' : 'Register for'} {selectedRace?.name}
        </h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1">This links your account to your bib so organizers can record your checkpoint times.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Full Name</label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
              <input type="text" required value={fullName} onChange={(e) => setFullName(e.target.value.toUpperCase())}
                className="w-full glass-inset pl-10 pr-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" placeholder="EX: JUAN DELA CRUZ" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Race Distance</label>
            {existingForRace ? (
              <div className="glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <MapPin className="w-4 h-4 text-red-500" /> {existingForRace.distance}
              </div>
            ) : (
              <div className="relative">
                <MapPin className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                <select value={distance} onChange={(e) => setDistance(e.target.value)}
                  className="w-full appearance-none glass-inset pl-10 pr-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50">
                  {raceDistances.map((d) => <option key={d.id} value={d.label}>{d.label}</option>)}
                  <option value="Custom">Custom Distance...</option>
                </select>
              </div>
            )}
            {!existingForRace && raceDistances.length === 0 && (
              <p className="text-[10.5px] text-[var(--text-muted)] mt-1.5 pl-1">This race has no preset distances yet - enter your own below.</p>
            )}
          </div>

          {!existingForRace && distance === 'Custom' && (
            <input type="text" required value={customDistance} onChange={(e) => setCustomDistance(e.target.value.toUpperCase())}
              className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" placeholder="EX: 15K TRAIL RUN" />
          )}

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Entry Category</label>
            {existingForRace ? (
              <div className="glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><Users2 className="w-4 h-4 text-red-500" /> {entryCategoryLabels[runnerEntryCategory(existingForRace)]}</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {availableEntryCategories.map((category) => <button key={category} type="button" onClick={() => setEntryCategory(category)} className={`rounded-xl border px-2 py-2.5 text-[10px] font-black uppercase tracking-wide transition ${entryCategory === category ? 'border-red-500/45 bg-red-500/10 text-red-500' : 'border-[var(--border-default)] glass-inset text-[var(--text-secondary)]'}`}>{entryCategoryLabels[category]}</button>)}
              </div>
            )}
          </div>

          {entryCategory !== 'solo' && (
            <div className="glass-inset p-3 space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">{entryCategoryLabels[entryCategory]} Team Name</label>
                <input type="text" required value={teamName} onChange={(e) => setTeamName(e.target.value.toUpperCase())} className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" placeholder="EX: TEAM RACEPULSE" />
              </div>
              {Array.from({ length: entryMemberCount[entryCategory] }).map((_, index) => (
                <div key={index}>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Member {index + 1}{index === 0 ? ' / Team Captain' : ''}</label>
                  <input type="text" required value={index === 0 ? fullName : (teamMembers[index] || '')} onChange={(e) => {
                    const value = e.target.value.toUpperCase();
                    if (index === 0) setFullName(value);
                    else setTeamMembers((current) => { const next = [...current]; next[index] = value; return next; });
                  }} className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" placeholder={`FULL NAME OF MEMBER ${index + 1}`} />
                </div>
              ))}
              <p className="text-[10px] text-[var(--text-muted)]">One shared bib and timing chip will be assigned to this team. Their result is ranked against other {entryCategoryLabels[entryCategory]} teams only.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Gender</label>
              <select value={gender} onChange={(e) => setGender(e.target.value as Gender)}
                className="w-full appearance-none glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50">
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Age</label>
              <input type="number" required min={1} max={120} value={age} onChange={(e) => setAge(e.target.value)}
                className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" placeholder="EX: 27" />
            </div>
          </div>
          <p className="text-[10.5px] text-[var(--text-muted)] -mt-2 pl-1">Used to place you in the correct age category on race reports.</p>
          <div className="glass-inset p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-[var(--text-secondary)]"><HeartPulse className="w-4 h-4 text-red-500" /> Emergency Contact</div>
            <p className="text-[10.5px] text-[var(--text-muted)] -mt-1">Used only by the race organizer in case of an emergency.</p>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Contact Person</label>
              <input type="text" required value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value.toUpperCase())} maxLength={100} className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" placeholder="EX: MARIA DELA CRUZ (MOTHER)" />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Contact Number</label>
              <div className="relative"><Phone className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" /><input type="tel" required value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} maxLength={30} className="w-full glass-inset pl-10 pr-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" placeholder="EX: 0917 123 4567" /></div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Shirt Size <span className="normal-case font-normal text-[var(--text-muted)]">(for this race)</span></label>
            <ShirtSizePicker key={`${raceId}_${existingForRace?.shirtSize || initialShirtSize || ''}`} value={shirtSize} onChange={setShirtSize} emptyLabel="Select shirt size" />
            <p className="text-[10.5px] text-[var(--text-muted)] mt-1.5 pl-1">The kit desk will see this size when you claim your race kit.</p>
          </div>

          <p className="text-[10.5px] text-[var(--text-secondary)] glass-inset px-3 py-2 flex items-center gap-1.5">
            <Hash className="w-3 h-3 text-red-500 shrink-0" />
            {existingForRace
              ? `Your bib number stays #${existingForRace.bibNumber}.`
              : 'Your bib number is assigned automatically based on your distance (e.g. first 5K registrant gets "5-001").'}
          </p>

          {!existingForRace && selectedRace.onlinePaymentEnabled && (raceDistances.find((item) => item.label === distance)?.price || 0) > 0 && (
            <p className="text-[10.5px] text-emerald-500 border border-emerald-500/25 bg-emerald-500/5 rounded-xl px-3 py-2 flex items-center gap-1.5"><Coins className="w-3.5 h-3.5 shrink-0" /> Secure checkout: GCash, Maya, QRPh, or card. Your registration is confirmed only after payment verification.</p>
          )}
          {!existingForRace && selectedRace.manualPaymentEnabled && (raceDistances.find((item) => item.label === distance)?.price || 0) > 0 && (
            <div className="text-[10.5px] text-amber-500 border border-amber-500/25 bg-amber-500/5 rounded-xl px-3 py-2.5">
              <p className="font-bold">Manual payment • ₱{(raceDistances.find((item) => item.label === distance)?.price || 0).toFixed(2)}</p>
              <p className="text-[var(--text-secondary)] whitespace-pre-line mt-1">{selectedRace.manualPaymentInstructions || 'Submit your registration, then follow the organizer’s payment instructions. Your bib will be reserved pending verification.'}</p>
              {selectedRace.manualPaymentQrImage && (
                <div className="mt-3 text-center">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-500 mb-1.5">Scan to pay</p>
                  <img src={selectedRace.manualPaymentQrImage} alt="GCash or QRPh payment code" className="mx-auto w-48 max-w-full rounded-xl bg-white p-2 shadow-sm" />
                </div>
              )}
              <div className="mt-3">
                <label className="block text-[10px] font-black uppercase tracking-widest text-amber-500 mb-1.5">Payment reference number <span className="text-red-500">required</span></label>
                <input type="text" required value={paymentReference} onChange={(event) => setPaymentReference(event.target.value.toUpperCase())} maxLength={100} autoCapitalize="characters" autoCorrect="off" placeholder="GCash / bank transaction reference" className="w-full glass-inset px-3 py-2.5 text-sm font-mono font-bold tracking-wide text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-amber-500/50" />
                <p className="mt-1.5 text-[10px] text-[var(--text-secondary)]">We use this to match your payment. A screenshot is not required.</p>
              </div>
            </div>
          )}

          {(checkingPayment || paymentReturn?.status === 'pending' || paymentReturn?.status === 'creating') && (
            <p className="text-[10.5px] text-amber-500 border border-amber-500/25 bg-amber-500/5 rounded-xl px-3 py-2 flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" /> Verifying your PayMongo payment securely…</p>
          )}
          {(paymentReturn?.status === 'failed' || paymentReturn?.status === 'expired') && (
            <p className="text-[10.5px] text-red-500 border border-red-500/25 bg-red-500/5 rounded-xl px-3 py-2">Your checkout was not completed. No registration was created; you may try payment again.</p>
          )}

          {error && <p className="text-xs text-red-500 font-semibold">⚠️ {error}</p>}

          <button type="submit" disabled={saving}
            className="w-full py-3.5 px-6 rounded-[var(--radius-control)] font-display font-black uppercase text-xs tracking-widest shadow-xl flex items-center justify-center gap-2 transition duration-200 text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-red-900/30 disabled:opacity-60">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />} {existingForRace ? 'Update Registration' : selectedRace.onlinePaymentEnabled && (raceDistances.find((item) => item.label === distance)?.price || 0) > 0 ? `Continue to payment • ₱${(raceDistances.find((item) => item.label === distance)?.price || 0).toFixed(2)}` : selectedRace.manualPaymentEnabled && (raceDistances.find((item) => item.label === distance)?.price || 0) > 0 ? `Reserve slot • Manual payment ₱${(raceDistances.find((item) => item.label === distance)?.price || 0).toFixed(2)}` : 'Save Race Profile'}
          </button>
      </form>
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
  return timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined;
}

function RunnerRacePass({ race, runnerProfile, result, orderedCheckpoints }: {
  race: Race;
  runnerProfile: RunnerProfile;
  result: ReturnType<typeof computeResults>[number] | undefined;
  orderedCheckpoints: Race['checkpoints'];
}) {
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
      detail: result?.sequenceStartTime ? 'Started at previous entry finish' : startSplit ? start.label : result?.timingMethod === 'gun' ? 'Official wave gun-time fallback' : start.label,
      completed: !!startSplit || !!result?.sequenceStartTime || result?.timingMethod === 'gun',
      timestamp: result?.sequenceStartTime || startSplit?.timestamp || (result?.timingMethod === 'gun' ? getWaveStartTime(race, runnerProfile.distance, runnerEntryCategory(runnerProfile)) : undefined),
    }] : []),
    ...(finish ? [{ id: 'finish', label: 'Finished', detail: finish.label, completed: !!finishSplit, timestamp: finishSplit?.timestamp }] : []),
    { id: 'result', label: 'Official result', detail: hasOfficialResult ? `Rank #${result!.rank} • ${result!.finishTime}` : 'Available after your finish is recorded', completed: hasOfficialResult, timestamp: hasOfficialResult ? finishSplit?.timestamp : undefined },
  ];
  const currentStep = [...steps].reverse().find((step) => step.completed)?.label || 'Registered';

  return (
    <div className="lg:col-span-12 glass-panel overflow-hidden animate-fadeIn">
      <div className="relative p-5 sm:p-6 overflow-hidden">
        {race.posterImage && <img src={race.posterImage} alt="" className="absolute inset-0 w-full h-full object-cover opacity-[0.12]" />}
        <div className="absolute inset-0 bg-gradient-to-r from-red-950/60 via-[var(--surface-panel)]/90 to-[var(--surface-panel)]" />
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-red-400 bg-red-500/10 border border-red-500/25 rounded-full px-2.5 py-1"><Radio className="w-3 h-3" /> My Race Pass</span>
            <h2 className="heading-float text-xl sm:text-2xl font-black font-display uppercase tracking-tight text-[var(--text-primary)] mt-3 truncate">{race.name}</h2>
            <p className="text-xs text-[var(--text-secondary)] mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1"><span className="inline-flex items-center gap-1"><Calendar className="w-3.5 h-3.5 text-red-500 mr-1.5" />{race.date}</span><span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-red-500 mr-1.5" />{runnerProfile.distance}</span></p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="glass-inset px-4 py-3 text-center min-w-[104px]">
              <span className="block text-[9px] font-bold uppercase tracking-widest text-[var(--text-secondary)]">Bib number</span>
              <span className="block text-xl font-mono font-black tracking-wider text-red-500 mt-0.5">#{runnerProfile.bibNumber}</span>
            </div>
            <div className="bg-white p-2 rounded-xl shadow-xl border border-zinc-200" title="Show this QR code at a race checkpoint">
              <QRCodeSVG value={`RPCHIPv1|${runnerProfile.raceId}|${runnerProfile.bibNumber}`} size={66} level="M" />
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6 border-t border-[var(--border-default)]">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)]">Race status</h3>
            <p className="text-xs text-[var(--text-primary)] font-bold mt-1">Current: <span className="text-red-500">{currentStep}</span></p>
          </div>
          {result?.finishTime && <span className="text-xs font-mono font-black text-emerald-400 border border-emerald-500/25 bg-emerald-500/10 rounded-full px-3 py-1.5">Official time {result.finishTime}</span>}
        </div>
        <ol className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-2">
          {steps.map((step, index) => (
            <li key={step.id} className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${step.completed ? 'border-red-500/25 bg-red-500/5' : 'border-[var(--border-default)] bg-[var(--surface-inset)]/35'}`}>
              <span className={step.completed ? 'text-red-500' : 'text-[var(--text-muted)]'}>{step.completed ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}</span>
              <span className="min-w-0"><span className="block text-xs font-black text-[var(--text-primary)]">{index + 1}. {step.label}</span><span className="block text-[10px] text-[var(--text-secondary)] truncate">{step.completed && step.timestamp ? formatScanTime(step.timestamp) : step.detail}</span></span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function DigitalRaceBib({ race, runnerProfile }: { race: Race; runnerProfile: RunnerProfile }) {
  const bibRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const bibTemplate = resolveRaceBibTemplate(race, runnerProfile.distance);
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
      const template = await loadDataImage(bibTemplate.image);
      const canvas = document.createElement('canvas');
      canvas.width = template.naturalWidth;
      canvas.height = template.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas rendering is not supported by this browser.');
      ctx.drawImage(template, 0, 0, canvas.width, canvas.height);
      drawFittedRaceBibText(
        ctx, runnerProfile.bibNumber, canvas.width, canvas.height,
        layout.bibNumberX, layout.bibNumberY, layout.bibNumberSize ?? 12,
        layout.bibNumberColor ?? '#FFFFFF', layout.bibNumberStrokeColor ?? '#000000', layout.bibNumberStrokeWidth ?? 0, raceBibFontFamily(layout.bibNumberFont, race.raceBibCustomFont, true),
      );
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
          <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2"><Hash className="w-4 h-4 text-red-500" /> Your Digital Race Bib</h3>
          <p className="text-[10.5px] text-[var(--text-secondary)] mt-1">Your name and official bib number are ready for this race.</p>
        </div>
      </div>
      <div ref={bibRef} className="relative w-full aspect-[3/2] overflow-hidden rounded-xl bg-[var(--surface-inset)] select-none" style={{ containerType: 'inline-size' }}>
        <img src={bibTemplate.image} alt={`${race.name} personalized race bib`} className="absolute inset-0 w-full h-full object-cover" />
        <span className="absolute -translate-x-1/2 -translate-y-1/2 leading-none font-black tracking-tight drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)] whitespace-nowrap" style={{ left: `${layout.bibNumberX}%`, top: `${layout.bibNumberY}%`, fontSize: `${layout.bibNumberSize ?? 12}cqw`, color: layout.bibNumberColor ?? '#FFFFFF', fontFamily: raceBibFontFamily(layout.bibNumberFont, race.raceBibCustomFont), WebkitTextStroke: `${layout.bibNumberStrokeWidth ?? 0}cqw ${layout.bibNumberStrokeColor ?? '#000000'}`, paintOrder: 'stroke fill' }}>{runnerProfile.bibNumber}</span>
        <div className="absolute -translate-x-1/2 -translate-y-1/2 w-[90%] text-center leading-[1.16] font-black tracking-wide drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)]" style={{ left: `${layout.runnerNameX}%`, top: `${layout.runnerNameY}%`, fontSize: `${previewNameSize}cqw`, color: layout.runnerNameColor ?? '#FFFFFF', fontFamily: raceBibFontFamily(layout.runnerNameFont, race.raceBibCustomFont), WebkitTextStroke: `${layout.runnerNameStrokeWidth ?? 0}cqw ${layout.runnerNameStrokeColor ?? '#000000'}`, paintOrder: 'stroke fill' }}>{nameLines.map((name, index) => <span key={`${name}-${index}`} className="block">{name}</span>)}</div>
      </div>
      <button type="button" onClick={handleDownload} disabled={downloading} className="w-full py-2.5 px-4 rounded-[var(--radius-control)] font-display font-black uppercase text-[10px] tracking-widest text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-lg shadow-red-900/30 transition disabled:opacity-60 flex items-center justify-center gap-2">
        {downloading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} {downloading ? 'Preparing Bib...' : 'Download Race Bib'}
      </button>
      {downloadError && <p className="text-[10.5px] text-red-500 text-center">{downloadError}</p>}
    </div>
  );
}

function RunnerSplitsView({ runnerProfile }: { runnerProfile: RunnerProfile }) {
  const [race, setRace] = useState<Race | null | undefined>(undefined);
  const [chipReads, setChipReads] = useState<ChipRead[]>([]);
  const [officialEntry, setOfficialEntry] = useState<PublicLeaderboardEntry | null>(null);

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
      finishTime: officialEntry.finishTime,
      chipTime: officialEntry.chipTime,
      gunTime: officialEntry.gunTime,
      sequenceStartTime: officialEntry.sequenceStartTime,
      rank: officialEntry.overallRank ?? officialEntry.rank,
      overallRank: officialEntry.overallRank ?? officialEntry.rank,
      categoryRank: officialEntry.categoryRank,
      categoryLabel: officialEntry.categoryLabel,
      timingMethod: officialEntry.timingMethod || localResult.timingMethod,
    };
  }, [localResult, officialEntry, resultsArePublic]);

  const orderedCheckpoints = useMemo(() => race ? [...race.checkpoints].sort((a, b) => a.order - b.order) : [], [race]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      {race && <RunnerRacePass race={race} runnerProfile={runnerProfile} result={result} orderedCheckpoints={orderedCheckpoints} />}
      <div className="lg:col-span-7 space-y-6">
        <div className="glass-panel p-5">
          <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-red-500" /> Checkpoint Splits
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
                <div key={cp.id} className="flex items-center justify-between glass-inset px-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-[var(--text-primary)]">{cp.label}</span>
                    <span className="block text-[9px] font-bold uppercase tracking-wide text-[var(--text-muted)] mt-0.5">
                      {phase === 'checkin' ? 'Check-In' : phase === 'start' ? 'Official Start' : phase === 'finish' ? 'Finish' : cutoffDeadline ? `Cutoff ${cutoffDeadline.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Split'}
                    </span>
                  </span>
                  <span className={`font-mono text-sm font-black shrink-0 text-right ${afterCutoff ? 'text-amber-500' : usesSequenceStart ? 'text-emerald-500' : split ? 'text-red-500' : usesGunFallback ? 'text-emerald-500' : 'text-[var(--text-muted)]'}`}>
                    {usesSequenceStart ? new Date(result!.sequenceStartTime!).toLocaleTimeString() : split ? new Date(split.timestamp).toLocaleTimeString() : usesGunFallback ? `Gun ${new Date(waveStartTime!).toLocaleTimeString()}` : 'Pending'}
                    {usesSequenceStart && <span className="block text-[9px] font-sans uppercase tracking-wide">Previous entry finish</span>}
                    {afterCutoff && <span className="block text-[9px] font-sans uppercase tracking-wide">After cutoff</span>}
                    {usesGunFallback && <span className="block text-[9px] font-sans uppercase tracking-wide">Official fallback</span>}
                  </span>
                </div>
              );
            })}
          </div>

          {result?.finishTime && (
            <div className="mt-4 bg-emerald-950/20 border border-emerald-800/40 p-4 rounded-2xl text-center">
              <p className="text-[10px] uppercase font-bold tracking-widest text-emerald-500">Finish Time</p>
              <p className="text-2xl font-mono font-black text-emerald-400 mt-1">{result.finishTime}</p>
              {result.overallRank && <p className="text-xs text-emerald-500 mt-1">Overall #{result.overallRank} in {runnerDivisionLabel(runnerProfile)}{result.categoryRank ? ` · ${result.categoryLabel || 'Category'} #${result.categoryRank}` : ''}</p>}
              {race && (
                <button
                  type="button"
                  onClick={() => downloadFinisherCertificate(race, runnerProfile, result)}
                  className="mt-4 w-full sm:w-auto px-4 py-2.5 rounded-[var(--radius-control)] font-display font-black uppercase text-[10px] tracking-widest text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-lg shadow-red-900/30 transition inline-flex items-center justify-center gap-2"
                >
                  <FileDown className="w-4 h-4" /> Download E-Certificate
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="lg:col-span-5 space-y-6">
        <div className="glass-panel p-5 text-center space-y-4">
          <h3 className="text-[11px] font-black font-display uppercase tracking-widest text-[var(--text-secondary)]">Your Checkpoint Bib QR</h3>
          <p className="text-[11px] text-[var(--text-secondary)]">Show this to organizers at each checkpoint to scan-and-record your time.</p>
          <div className="bg-white p-4 rounded-2xl inline-block shadow-xl border border-zinc-200">
            <QRCodeSVG value={`RPCHIPv1|${runnerProfile.raceId}|${runnerProfile.bibNumber}`} size={180} level="M" />
          </div>
          <div className="glass-inset p-3">
            <span className="text-[10px] font-mono text-[var(--text-secondary)] uppercase block tracking-wider mb-1">Bib Number</span>
            <span className="text-xl font-mono font-black text-red-500 tracking-widest">#{runnerProfile.bibNumber}</span>
          </div>
        </div>
        {race && <DigitalRaceBib race={race} runnerProfile={runnerProfile} />}
      </div>
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
  const [races, setRaces] = useState<Race[]>([]);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [username, setUsername] = useState(profile.username || '');
  const [nickname, setNickname] = useState(profile.nickname || '');
  const [photoPreview, setPhotoPreview] = useState<string | null>(profile.photoURL || null);
  const [emergencyContactName, setEmergencyContactName] = useState(profile.emergencyContactName || '');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState(profile.emergencyContactPhone || '');
  const [shirtSize, setShirtSize] = useState(profile.shirtSize || '');
  const [medicalNotes, setMedicalNotes] = useState(profile.medicalNotes || '');
  const [saving, setSaving] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'races'), (snapshot) => {
      const list: Race[] = [];
      snapshot.forEach((docSnap) => list.push(docSnap.data() as Race));
      setRaces(list);
    }, (err) => console.warn('Races listener failed:', err.message));
    return () => unsubscribe();
  }, []);

  const raceById = useMemo(() => new Map(races.map((r) => [r.id, r])), [races]);
  const mostRecentPast = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    return [...runnerProfiles]
      .filter((rp) => (raceById.get(rp.raceId)?.date || '9999') < todayStr)
      .sort((a, b) => (raceById.get(b.raceId)?.date || '').localeCompare(raceById.get(a.raceId)?.date || ''))[0];
  }, [runnerProfiles, raceById]);

  const [recentResult, setRecentResult] = useState<ReturnType<typeof computeResults>[number] | null | undefined>(undefined);

  useEffect(() => {
    const race = mostRecentPast ? raceById.get(mostRecentPast.raceId) : undefined;
    if (!mostRecentPast || !race) {
      setRecentResult(null);
      return;
    }
    (async () => {
      try {
        const snapshot = await getDocs(
          query(collection(db, 'chipReads'), where('raceId', '==', race.id), where('bibNumber', '==', mostRecentPast.bibNumber))
        );
        const chipReads: ChipRead[] = [];
        snapshot.forEach((docSnap) => chipReads.push(docSnap.data() as ChipRead));
        const result = computeResults(race.checkpoints, chipReads, [mostRecentPast]).find((r) => r.bibNumber === mostRecentPast.bibNumber);
        setRecentResult(result || null);
      } catch (err) {
        console.warn('Failed to load recent race result:', err);
        setRecentResult(null);
      }
    })();
  }, [mostRecentPast?.raceId, mostRecentPast?.bibNumber]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file.');
      return;
    }
    setError('');
    try {
      const dataUrl = await resizeImageToDataUrl(file, 200, 200);
      setPhotoPreview(dataUrl);
    } catch (err: any) {
      setError(err.message || 'Failed to process the image.');
    }
  };

  const handleSave = async () => {
    if (!displayName.trim()) {
      setError('Please enter your full name.');
      return;
    }
    const nextUsername = normalizedUsername(username);
    if (nextUsername && !usernamePattern.test(nextUsername)) {
      setError('Username must be 3–24 characters: letters, numbers, dot, underscore, or hyphen.');
      return;
    }
    if (profile.username && nextUsername !== profile.username) {
      setError('Your username is permanent once set.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await updateAccountDisplayName(displayName);
      const profileUpdate = {
        displayName: displayName.trim(),
        nickname: nickname.trim(),
        emergencyContactName: emergencyContactName.trim(),
        emergencyContactPhone: emergencyContactPhone.trim(),
        shirtSize,
        medicalNotes: medicalNotes.trim(),
        ...(photoPreview ? { photoURL: photoPreview } : {}),
      };

      if (!profile.username && nextUsername) {
        await runTransaction(db, async (transaction) => {
          const usernameRef = doc(db, 'usernameIndex', nextUsername);
          const usernameSnap = await transaction.get(usernameRef);
          if (usernameSnap.exists()) throw new Error('That username is already taken. Please choose another one.');
          transaction.update(doc(db, 'users', profile.uid), { ...profileUpdate, username: nextUsername });
          transaction.set(usernameRef, {
            username: nextUsername,
            uid: profile.uid,
            email: profile.email,
            createdAt: new Date().toISOString(),
          });
          const friendPayload = {
            uid: profile.uid,
            username: nextUsername,
            displayName: displayName.trim(),
            ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
            ...(photoPreview ? { photoURL: photoPreview } : {}),
            updatedAt: new Date().toISOString(),
          };
          transaction.set(doc(db, 'friendDirectory', nextUsername), friendPayload);
          transaction.set(doc(db, 'friendProfiles', profile.uid), friendPayload);
        });
      } else {
        await updateDoc(doc(db, 'users', profile.uid), profileUpdate);
        if (profile.username) {
          const friendPayload = {
            uid: profile.uid,
            username: profile.username,
            displayName: displayName.trim(),
            ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
            ...(photoPreview ? { photoURL: photoPreview } : {}),
            updatedAt: new Date().toISOString(),
          };
          await Promise.all([
            setDoc(doc(db, 'friendDirectory', profile.username), friendPayload, { merge: true }),
            setDoc(doc(db, 'friendProfiles', profile.uid), friendPayload, { merge: true }),
          ]);
        }
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save your profile.');
    } finally {
      setSaving(false);
    }
  };

  const recentRace = mostRecentPast ? raceById.get(mostRecentPast.raceId) : undefined;

  if (resettingPassword) return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto">
        <PasswordResetFlow initialEmail={profile.email} backLabel="Back to profile" onBack={() => setResettingPassword(false)} onDone={() => void signOutUser()} />
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="glass-panel w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto p-6 space-y-5 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[var(--text-secondary)] hover:text-[var(--text-primary)] glass-inset p-2 rounded-full transition"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="relative w-24 h-24 rounded-full overflow-hidden glass-inset flex items-center justify-center text-red-500 font-black text-3xl group"
            title="Change profile picture"
          >
            {photoPreview ? (
              <img src={photoPreview} alt="" className="w-full h-full object-cover" />
            ) : (
              (nickname || profile.displayName || '?').charAt(0).toUpperCase()
            )}
            <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
              <Camera className="w-6 h-6 text-white" />
            </span>
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
          <button type="button" onClick={() => fileInputRef.current?.click()} className="text-[10.5px] font-bold text-red-500 hover:text-red-400 flex items-center gap-1 uppercase tracking-wide">
            <Pencil className="w-3 h-3" /> Change Photo
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Full Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={100}
              className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Nickname</label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={profile.displayName}
              maxLength={30}
              className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Account Email</label>
            <div className="glass-inset px-4 py-3 text-sm text-[var(--text-secondary)] flex items-center gap-2"><Mail className="w-4 h-4 text-red-500" />{profile.email}</div>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Sign-in Username</label>
            {profile.username ? (
              <div className="glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><User className="w-4 h-4 text-red-500" />{profile.username}</div>
            ) : (
              <>
                <input type="text" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoCapitalize="none" autoCorrect="off" maxLength={24} placeholder="e.g. juan.runner" className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" />
                <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">Optional for existing accounts. Once saved, you can sign in using this username and it cannot be changed.</p>
              </>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-1.5"><PackageCheck className="w-3.5 h-3.5 text-red-500" /> Race preferences</h3>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Shirt Size</label>
            <ShirtSizePicker value={shirtSize} onChange={setShirtSize} emptyLabel="Not selected" />
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-1.5"><HeartPulse className="w-3.5 h-3.5 text-red-500" /> Emergency &amp; medical</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Emergency Contact</label>
              <input type="text" value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} maxLength={100} placeholder="Full name" className="w-full glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Contact Number</label>
              <div className="relative"><Phone className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" /><input type="tel" value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} maxLength={30} placeholder="09XX XXX XXXX" className="w-full glass-inset pl-10 pr-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" /></div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Medical Note <span className="normal-case font-normal text-[var(--text-muted)]">(optional)</span></label>
            <textarea value={medicalNotes} onChange={(e) => setMedicalNotes(e.target.value)} maxLength={600} rows={3} placeholder="Example: allergy, asthma, or other information for race-day emergencies." className="w-full resize-y glass-inset px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" />
            <p className="text-[10px] text-[var(--text-muted)] mt-1">Keep this brief. It is visible only to you and authorized RacePulse staff.</p>
          </div>
        </div>

        <div className="glass-inset p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div><p className="text-xs font-black text-[var(--text-primary)]">Password</p><p className="text-[10px] text-[var(--text-secondary)] mt-0.5">We’ll send a secure reset link to your email.</p></div>
          <button type="button" onClick={() => setResettingPassword(true)} className="text-[10px] font-black uppercase tracking-wide px-3 py-2.5 rounded-[14px] bg-red-500/10 text-red-500 border border-red-500/25 hover:bg-red-500 hover:text-white transition">Reset password</button>
        </div>

        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5 text-red-500" /> Most Recent Race
          </h3>
          {!mostRecentPast || !recentRace ? (
            <p className="text-xs text-[var(--text-secondary)] glass-inset px-3 py-2.5">No completed races yet.</p>
          ) : recentResult === undefined ? (
            <p className="text-xs text-[var(--text-secondary)] glass-inset px-3 py-2.5 flex items-center gap-1.5"><RefreshCw className="w-3 h-3 animate-spin" /> Loading...</p>
          ) : (
            <div className="glass-inset px-4 py-3 space-y-1.5">
              <p className="text-sm font-bold text-[var(--text-primary)]">{recentRace.name}</p>
              <p className="text-[10px] text-[var(--text-secondary)]">{recentRace.date} &bull; {mostRecentPast.distance} &bull; #{mostRecentPast.bibNumber}</p>
              <div className="flex items-center gap-4 pt-1">
                <div>
                  <span className="block text-[9px] uppercase font-bold text-[var(--text-muted)] tracking-wider">Rank</span>
                  <span className="text-lg font-mono font-black text-red-500">{recentResult?.rank ? `#${recentResult.rank}` : '—'}</span>
                </div>
                <div>
                  <span className="block text-[9px] uppercase font-bold text-[var(--text-muted)] tracking-wider">Finish Time</span>
                  <span className="text-lg font-mono font-black text-red-500">{recentResult?.finishTime || '—'}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-red-500 font-semibold">⚠️ {error}</p>}
        {notice && <p className="text-xs text-emerald-500 font-semibold">✓ {notice}</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3.5 px-6 rounded-[var(--radius-control)] font-display font-black uppercase text-xs tracking-widest shadow-xl flex items-center justify-center gap-2 transition duration-200 text-white bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-red-900/30 disabled:opacity-60"
        >
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <User className="w-4 h-4" />} Save Settings
        </button>
        <div className="rounded-[var(--radius-control)] border border-red-500/25 bg-red-500/5 p-4 space-y-2">
          <p className="text-xs font-black uppercase tracking-wider text-red-400">Danger zone</p>
          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">Permanently remove your account, profile, and race registrations.</p>
          <button type="button" onClick={() => setShowDeleteAccount(true)} className="text-[10px] font-black uppercase tracking-wide px-3 py-2.5 rounded-[14px] border border-red-500/35 text-red-500 hover:bg-red-500 hover:text-white transition">Delete my account</button>
        </div>
      </div>
      {showDeleteAccount && <DeleteAccountModal profile={profile} onClose={() => setShowDeleteAccount(false)} />}
    </div>
  );
}
