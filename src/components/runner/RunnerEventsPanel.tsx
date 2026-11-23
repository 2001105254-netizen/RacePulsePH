import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, runTransaction, setDoc, where } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  CheckCircle2,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Coins,
  Flag,
  Hash,
  HeartPulse,
  LayoutGrid,
  MapPin,
  Maximize2,
  PackageCheck,
  Phone,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  Trophy,
  User,
  UserPlus,
  Users2,
  X,
} from 'lucide-react';
import { db } from '../../firebase';
import { useAccess } from '../../lib/access';
import { isClientNavigationClick } from '../../lib/appRouting';
import type { LegalDocKey } from '../../lib/legalConfig';
import {
  createPayMongoCheckout,
  getPaymentStatus,
  PaymentRequestError,
  PaymentStatusResponse,
} from '../../lib/payments';
import { buildHumanFormSignals } from '../../lib/botProtection';
import { computeBackoffMs } from '../../lib/resilientFetch';
import TurnstileChallenge from '../TurnstileChallenge';
import { entryCategoryLabels, entryMemberCount, raceEntryCategories, runnerEntryCategory } from '../../lib/raceEntry';
import { isRaceRegistrationOpen } from '../../lib/raceRegistration';
import { FriendProfile, Gender, Race, RaceEntryCategory, RunnerProfile } from '../../types';
import { useAndroidBackHandler } from '../../lib/capacitorAndroid';
import EventCourseRunnerPanel from '../routes/EventCourseRunnerPanel';
import DialogSurface from '../ui/DialogSurface';
import { Select } from '../ui/Select';
import {
  RunnerBottomSheetDetent,
  RunnerFilterRail,
  RunnerFloatingStatusPill,
  RunnerQueueSkeleton,
  RunnerTelemetryStrip,
  RunnerThumbActionBar,
  type QueueStatusTone,
  type SheetDetent,
} from './RunnerMobilePrimitives';
import { formatFeeRangePH, mostRecent, sortedRaceDistances, standardShirtSizes } from './runnerUtils';

export type OpenEventsFilter = 'all' | 'unjoined' | 'registered';
type SortKey = 'date' | 'name' | 'distances' | 'fee';
type SortDir = 'asc' | 'desc';

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

const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export interface RunnerEventsPanelProps {
  uid: string;
  friendIdentity?: { username?: string; displayName: string };
  runnerProfiles: RunnerProfile[];
  registeredRaceIds: Set<string>;
  initialShirtSize?: string;
  requestedRaceId?: string | null;
  onRequestedRaceHandled?: () => void;
  onBrowseAllRaces: () => void;
  onScanQr?: () => void;
  onSaved: () => void;
  races: Race[];
  racesLoaded: boolean;
  racesError: string | null;
  isDesktop: boolean;
  isSplitPane?: boolean;
  isCompact?: boolean;
  imeOpen?: boolean;
  onCanvasModeChange?: (active: boolean) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  statusFilter: OpenEventsFilter;
  onStatusFilterChange: (value: OpenEventsFilter) => void;
  onMetricsChange?: (metrics: { total: number; unjoined: number; registered: number; showing: number }) => void;
  onFormViewChange?: (inFormFlow: boolean) => void;
  desktopSearchRef?: React.RefObject<HTMLInputElement | null>;
}

function ShirtSizePicker({
  id,
  value,
  onChange,
  emptyLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  emptyLabel: string;
}) {
  const [customMode, setCustomMode] = useState(() => Boolean(value && !(standardShirtSizes as readonly string[]).includes(value)));
  const usesCustomSize = customMode || Boolean(value && !(standardShirtSizes as readonly string[]).includes(value));
  return (
    <div className="space-y-2">
      <Select
        id={id}
        value={usesCustomSize ? '__other__' : value}
        onChange={(nextValue) => {
          if (nextValue === '__other__') {
            setCustomMode(true);
            onChange('');
          } else {
            setCustomMode(false);
            onChange(nextValue);
          }
        }}
        surface="inset"
        size="md"
        options={[
          { value: '', label: emptyLabel },
          ...standardShirtSizes.map((size) => ({ value: size, label: size })),
          { value: '__other__', label: 'Other size (type below)' },
        ]}
      />
      {usesCustomSize && (
        <div>
          <label htmlFor={`${id}-custom`} className="sr-only">
            Custom shirt size
          </label>
          <input
            id={`${id}-custom`}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            maxLength={20}
            placeholder="EX: 7XL, 3XS, CUSTOM"
            className="w-full min-h-11 glass-inset px-4 py-3 text-sm font-semibold uppercase text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
          />
        </div>
      )}
    </div>
  );
}

function formatGeneratedBib(
  km: number | null,
  entryCategory: RaceEntryCategory,
  sequence: number,
): string {
  const basePrefix = km !== null ? String(km) : 'CUSTOM';
  const suffix = entryCategory === 'duo' ? 'D' : entryCategory === 'trio' ? 'T' : entryCategory === 'group' ? 'G' : '';
  const prefix = suffix ? `${basePrefix}-${suffix}` : basePrefix;
  return `${prefix}-${String(sequence).padStart(3, '0')}`;
}

function bibCounterDocId(
  raceId: string,
  distanceLabel: string,
  entryCategory: RaceEntryCategory,
): string {
  return `${raceId}_${distanceLabel}_${entryCategory}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function RegistrationProgress({ currentStep, raceName }: { currentStep: 1 | 2 | 3; raceName?: string }) {
  const steps = ['Choose race', 'Runner details', 'Confirmed'];
  return (
    <nav
      aria-label="Registration progress"
      className="border border-[var(--border-default)] rounded-2xl bg-[var(--surface-card)] px-4 py-3 flex flex-wrap items-center justify-between gap-3"
    >
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <span className="text-xs font-semibold font-display uppercase tracking-wider text-red-700 dark:text-red-400 whitespace-nowrap">
          Event Registration
        </span>
        {raceName && (
          <>
            <span className="text-xs text-[var(--text-secondary)]" aria-hidden="true">
              /
            </span>
            <span className="text-xs font-semibold text-[var(--text-primary)] truncate max-w-[16rem] sm:max-w-[24rem]">
              {raceName}
            </span>
          </>
        )}
      </div>

      <ol className="flex flex-wrap items-center gap-2">
        {steps.map((label, idx) => {
          const step = (idx + 1) as 1 | 2 | 3;
          const complete = currentStep > step;
          const active = currentStep === step;
          return (
            <li
              key={label}
              aria-current={active ? 'step' : undefined}
              className={`rounded-lg px-2.5 py-1.5 border transition-colors ${
                active
                  ? 'border-red-600/45 bg-red-600/10 text-red-700 dark:text-red-400'
                  : complete
                    ? 'border-emerald-600/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : 'border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--text-secondary)]'
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
    </nav>
  );
}

function RegistrationConfirmation({
  race,
  registration,
  updated,
  onViewMyRace,
  onRegisterAnother,
}: {
  race?: Race;
  registration: RunnerProfile;
  updated: boolean;
  onViewMyRace: () => void;
  onRegisterAnother: () => void;
}) {
  return (
    <div className="max-w-xl mx-auto px-3 sm:px-4 py-3 space-y-4">
      <RegistrationProgress currentStep={3} raceName={race?.name} />
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 sm:p-6 text-center space-y-4 overflow-x-clip">
        <div className="w-12 h-12 rounded-full mx-auto bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="w-7 h-7" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-semibold font-display uppercase tracking-tight text-[var(--text-primary)]">
            {registration.paymentStatus === 'pending' ? 'Registration reserved' : 'Registration complete'}
          </h2>
          <p
            className={`text-xs font-semibold uppercase tracking-[0.16em] mt-1 ${
              registration.paymentStatus === 'pending'
                ? 'text-amber-800 dark:text-amber-300'
                : 'text-emerald-700 dark:text-emerald-400'
            }`}
          >
            {registration.paymentStatus === 'pending'
              ? 'Payment verification needed'
              : updated
                ? 'Registration updated'
                : 'Registration confirmed'}
          </p>
          <p className="text-xs text-[var(--text-secondary)] mt-1.5">
            {registration.paymentStatus === 'pending'
              ? 'Your bib is reserved. Follow the payment instructions below so the organizer can verify payment before race day.'
              : 'Your race registration is saved under your account.'}
          </p>
        </div>
        {registration.paymentStatus === 'pending' && (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-left">
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-800 dark:text-amber-300">
              Manual payment instructions
            </p>
            <p className="text-xs text-[var(--text-primary)] whitespace-pre-line mt-1">
              {race?.manualPaymentInstructions || 'Please contact the race organizer to complete payment.'}
            </p>
            {race?.manualPaymentQrImage && (
              <img
                src={race.manualPaymentQrImage}
                alt="GCash or QRPh payment code"
                className="mt-3 mx-auto w-44 max-w-full rounded-xl bg-white p-2"
              />
            )}
          </div>
        )}
        <div className="border-y border-[var(--border-subtle)] py-3 text-left grid grid-cols-2 gap-y-2.5 gap-x-4">
          <span>
            <span className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Race</span>
            <span className="block text-sm font-semibold text-[var(--text-primary)] mt-0.5 truncate">
              {race?.name || 'Race event'}
            </span>
          </span>
          <span>
            <span className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Race date</span>
            <span className="block text-sm font-semibold tabular-nums text-[var(--text-primary)] mt-0.5">
              {race?.date || 'To be announced'}
            </span>
          </span>
          <span>
            <span className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Distance</span>
            <span className="block text-sm font-semibold text-red-700 dark:text-red-400 mt-0.5">{registration.distance}</span>
          </span>
          <span>
            <span className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Bib number</span>
            <span className="block text-lg font-mono font-semibold tabular-nums text-red-700 dark:text-red-400 mt-0.5">
              #{registration.bibNumber}
            </span>
          </span>
          {registration.paymentStatus === 'pending' && registration.paymentReference && (
            <span className="col-span-2">
              <span className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                Payment reference
              </span>
              <span className="block text-sm font-mono font-semibold text-amber-800 dark:text-amber-300 mt-0.5 break-all">
                {registration.paymentReference}
              </span>
            </span>
          )}
          {registration.shirtSize && (
            <span>
              <span className="block text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)]">
                Shirt size
              </span>
              <span className="block text-sm font-semibold text-[var(--text-primary)] mt-0.5">{registration.shirtSize}</span>
            </span>
          )}
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          Your QR race pass and live race status appear under My Passes.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onViewMyRace}
            className="min-h-11 py-2.5 px-4 rounded-xl font-display font-semibold uppercase text-xs tracking-widest text-white bg-red-700 hover:bg-red-600 transition"
          >
            View My Race Pass
          </button>
          <button
            type="button"
            onClick={onRegisterAnother}
            className="min-h-11 py-3 px-4 rounded-xl font-display font-semibold uppercase text-xs tracking-widest border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)] transition"
          >
            Browse Open Events
          </button>
        </div>
      </div>
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
    return onSnapshot(
      query(collection(db, 'friendships'), where('members', 'array-contains', uid)),
      (snapshot) => {
        const connections: FriendshipRecord[] = [];
        snapshot.forEach((item) => connections.push(item.data() as FriendshipRecord));
        void (async () => {
          try {
            const loaded = await Promise.all(
              connections.map(async (connection) => {
                const friendUid = connection.fromUid === uid ? connection.toUid : connection.fromUid;
                const friend = await getDoc(doc(db, 'friendProfiles', friendUid));
                return friend.exists() ? (friend.data() as FriendProfile) : null;
              }),
            );
            setFriends(loaded.filter((item): item is FriendProfile => item !== null));
          } catch (err) {
            console.warn('Failed to load friends for race invite:', err);
          }
        })();
      },
      (err) => console.warn('Race invite friends listener failed:', err),
    );
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
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[var(--text-primary)]">Running with friends?</p>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">Send this event to an accepted RacePulse friend.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen((value) => !value);
            setMessage('');
          }}
          aria-expanded={open}
          className="min-h-11 lg:min-h-9 inline-flex items-center rounded-xl border border-red-700/35 bg-red-600/10 px-3 py-2 text-xs font-semibold text-red-700 dark:text-red-400 transition hover:bg-red-700 hover:text-white shrink-0"
        >
          <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Invite friends
        </button>
      </div>
      {open && (
        <div className="border-t border-[var(--border-subtle)] pt-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Choose friend</p>
          {friends.length === 0 ? (
            <p className="text-xs text-[var(--text-secondary)]">
              No accepted friends yet. Add friends first from the Friends tab.
            </p>
          ) : (
            <div className="space-y-2">
              {friends.map((friend) => (
                <div
                  key={friend.uid}
                  className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2"
                >
                  <span className="min-w-0">
                    <strong className="block truncate text-xs text-[var(--text-primary)]">
                      {friend.nickname || friend.displayName}
                    </strong>
                    <small className="text-xs font-mono text-[var(--text-secondary)]">@{friend.username}</small>
                  </span>
                  <button
                    type="button"
                    onClick={() => void invite(friend)}
                    disabled={sendingTo === friend.uid}
                    className="min-h-11 lg:min-h-8 inline-flex items-center rounded-lg bg-red-700 hover:bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {sendingTo === friend.uid ? 'Sending...' : 'Invite'}
                  </button>
                </div>
              ))}
            </div>
          )}
          {message && (
            <p
              role="status"
              className={`text-xs font-semibold ${
                message.startsWith('Invite sent') ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
              }`}
            >
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function OpenEventDetailsSections({
  uid,
  race,
  raceDistances,
  existingForRace,
  preferredDistance,
  friendIdentity,
  canInvite,
  onOpenLightbox,
  compactCourse = true,
}: {
  uid: string;
  race: Race;
  raceDistances: ReturnType<typeof sortedRaceDistances>;
  existingForRace: RunnerProfile | undefined;
  preferredDistance?: string;
  friendIdentity?: { username?: string; displayName: string };
  canInvite: boolean;
  onOpenLightbox: (media: { title: string; subtitle: string; src: string; alt: string }) => void;
  compactCourse?: boolean;
}) {
  return (
    <div className="divide-y divide-[var(--border-subtle)]">
      {existingForRace && (
        <div className="py-2.5 text-xs font-semibold text-amber-900 dark:text-amber-300 bg-amber-500/10 px-3 rounded-xl border border-amber-500/30 mb-3">
          Registered under Bib <span className="font-mono tabular-nums">#{existingForRace.bibNumber}</span> ({existingForRace.distance}). Continue to update your entry.
        </div>
      )}

      <div className="py-3 space-y-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
          <Coins className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
          Distances &amp; Pricing
        </h3>
        {raceDistances.length === 0 ? (
          <p className="text-xs text-[var(--text-secondary)]">Custom distance open.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {raceDistances.map((d) => (
              <span
                key={d.id}
                className="text-xs font-semibold px-2.5 py-1 rounded-md bg-red-700/10 dark:bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 font-mono tabular-nums"
              >
                {d.label}
                {d.price > 0 ? `: ₱${d.price.toFixed(0)}` : ' (Free)'}
              </span>
            ))}
          </div>
        )}
      </div>

      {!compactCourse && (
        <div className="py-3">
          <EventCourseRunnerPanel race={race} preferredDistance={preferredDistance} compact />
        </div>
      )}

      {(race.inclusions || []).length > 0 && (
        <div className="py-3 space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
            <PackageCheck className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
            Inclusions
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {race.inclusions.map((incl, idx) => (
              <span
                key={idx}
                className="text-xs font-semibold px-2.5 py-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)]"
              >
                {incl}
              </span>
            ))}
          </div>
        </div>
      )}

      {race.inclusionImage && (
        <div className="py-3 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
            <PackageCheck className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
            Shirt / Kit Design
          </h3>
          <button
            type="button"
            onClick={() =>
              onOpenLightbox({
                title: `${race.name} Shirt / Kit Design`,
                subtitle: race.date,
                src: race.inclusionImage!,
                alt: `${race.name} shirt or kit design`,
              })
            }
            className="group relative w-full rounded-xl overflow-hidden border border-[var(--border-default)] bg-[var(--surface-inset)] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
          >
            <img
              src={race.inclusionImage}
              alt={`${race.name} shirt or kit design`}
              className="w-full max-h-48 object-contain"
            />
            <span className="absolute right-2 bottom-2 inline-flex items-center gap-1.5 rounded-lg bg-black/80 px-2.5 py-1 text-xs font-semibold text-white">
              <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" /> Full screen
            </span>
          </button>
        </div>
      )}

      <div className="py-3 space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Course Checkpoints
        </h3>
        <p className="text-xs text-[var(--text-primary)] leading-relaxed">
          {[...(race.checkpoints || [])]
            .sort((a, b) => a.order - b.order)
            .map((c) => c.label)
            .join(' → ') || 'Checkpoints will be posted by the organizer.'}
        </p>
      </div>

      {friendIdentity?.username && canInvite && (
        <div className="py-3">
          <InviteFriendsToRace uid={uid} senderName={friendIdentity.displayName} race={race} />
        </div>
      )}
    </div>
  );
}

function OpenEventCanvasView({
  uid,
  race,
  raceDistances,
  existingForRace,
  preferredDistance,
  canRegister,
  canInvite,
  friendIdentity,
  onStartForm,
  onBrowseAllRaces,
  onOpenLightbox,
  onBack,
}: {
  uid: string;
  race: Race;
  raceDistances: ReturnType<typeof sortedRaceDistances>;
  existingForRace: RunnerProfile | undefined;
  preferredDistance?: string;
  canRegister: boolean;
  canInvite: boolean;
  friendIdentity?: { username?: string; displayName: string };
  onStartForm: () => void;
  onBrowseAllRaces: () => void;
  onOpenLightbox: (media: { title: string; subtitle: string; src: string; alt: string }) => void;
  onBack: () => void;
}) {
  const [detent, setDetent] = useState<SheetDetent>('peek');
  const statusLabel = existingForRace ? `Bib #${existingForRace.bibNumber}` : 'Reg Open';
  const statusTone: QueueStatusTone = existingForRace ? 'joined' : 'open';

  return (
    <div
      data-testid="open-event-canvas"
      className="fixed inset-0 z-[45] h-dvh overflow-hidden flex flex-col bg-[var(--surface-page)]"
    >
      <RunnerFloatingStatusPill
        idBadge={raceDistances[0]?.label}
        title={race.name}
        statusLabel={statusLabel}
        statusTone={statusTone}
        onBack={onBack}
        backLabel="Back to Open Events"
        rightSlot={
          race.posterImage ? (
            <button
              type="button"
              onClick={() =>
                onOpenLightbox({
                  title: race.name,
                  subtitle: race.date,
                  src: race.posterImage!,
                  alt: `${race.name} full event poster`,
                })
              }
              aria-label={`Inspect full poster for ${race.name}`}
              className="min-h-11 min-w-11 flex items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] shrink-0"
            >
              <Maximize2 className="w-4 h-4" aria-hidden="true" />
            </button>
          ) : undefined
        }
      />

      {/* Upper 60-70% Course Map & Event Overview Canvas */}
      <div
        className={`flex-1 min-h-0 overflow-y-auto overscroll-y-contain scroll-pt-24 scroll-pb-48 pt-[calc(76px+var(--rp-safe-top))] px-3 space-y-3 ${
          detent === 'half' ? 'pb-[52dvh]' : 'pb-[184px]'
        }`}
      >
        <RunnerTelemetryStrip
          ariaLabel="Event summary metrics"
          className="rounded-xl border border-[var(--border-default)]"
          items={[
            { key: 'cats', label: 'Categories', value: String(raceDistances.length || 1) },
            { key: 'splits', label: 'Splits', value: String((race.checkpoints || []).length) },
            { key: 'fee', label: 'Entry Fee', value: formatFeeRangePH(raceDistances), accent: 'red', wide: true },
          ]}
        />

        {race.posterImage && (
          <button
            type="button"
            onClick={() =>
              onOpenLightbox({
                title: race.name,
                subtitle: race.date,
                src: race.posterImage!,
                alt: `${race.name} full event poster`,
              })
            }
            aria-label={`View full poster for ${race.name}`}
            className="aspect-video w-full rounded-xl border border-[var(--border-default)] bg-[#141416] overflow-hidden block cursor-pointer"
          >
            <img
              src={race.posterImage}
              alt={`${race.name} uncropped event poster`}
              width={800}
              height={450}
              className="w-full h-full object-contain block"
            />
          </button>
        )}

        <EventCourseRunnerPanel race={race} preferredDistance={preferredDistance} compact />
      </div>

      {/* 3-Detent Bottom Sheet: Quick Summary CTA & Full Spec Manifest */}
      <RunnerBottomSheetDetent
        detent={detent}
        onDetentChange={setDetent}
        ariaLabel="Event registration and specifications"
        peekSummary={
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{race.name}</p>
            <p className="text-xs text-[var(--text-secondary)] truncate tabular-nums">
              {race.date} · {formatFeeRangePH(raceDistances)} · {raceDistances.length || 1} dist
            </p>
          </div>
        }
        primaryAction={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onStartForm}
              disabled={!canRegister}
              className="min-h-11 flex-1 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <span>{existingForRace ? 'Update Entry' : 'Register Now'}</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onBrowseAllRaces}
              aria-label="View official standings"
              className="min-h-11 min-w-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 shrink-0"
            >
              <Trophy className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
              <span className="hidden min-[360px]:inline">Standings</span>
            </button>
          </div>
        }
      >
        <OpenEventDetailsSections
          uid={uid}
          race={race}
          raceDistances={raceDistances}
          existingForRace={existingForRace}
          preferredDistance={preferredDistance}
          friendIdentity={friendIdentity}
          canInvite={canInvite}
          onOpenLightbox={onOpenLightbox}
        />
      </RunnerBottomSheetDetent>
    </div>
  );
}

export default function RunnerEventsPanel({
  uid,
  friendIdentity,
  runnerProfiles,
  registeredRaceIds,
  initialShirtSize,
  requestedRaceId,
  onRequestedRaceHandled,
  onBrowseAllRaces,
  onScanQr,
  onSaved,
  races,
  racesLoaded,
  racesError,
  isDesktop,
  isSplitPane = isDesktop,
  isCompact = !isSplitPane,
  imeOpen = false,
  onCanvasModeChange,
  searchQuery,
  onSearchQueryChange,
  statusFilter,
  onStatusFilterChange,
  onMetricsChange,
  onFormViewChange,
  desktopSearchRef,
}: RunnerEventsPanelProps) {
  const { can } = useAccess();
  const latest = mostRecent(runnerProfiles);

  const [selectedRaceId, setSelectedRaceId] = useState('');
  const [mobileInspecting, setMobileInspecting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [distanceFilter, setDistanceFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
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

  const [lightboxMedia, setLightboxMedia] = useState<{ title: string; subtitle: string; src: string; alt: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{ registration: RunnerProfile; wasUpdate: boolean } | null>(null);
  const [paymentReturn, setPaymentReturn] = useState<PaymentStatusResponse | null>(null);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [paymentPollTimedOut, setPaymentPollTimedOut] = useState(false);
  const [paymentCheckNonce, setPaymentCheckNonce] = useState(0);
  const [honeypot, setHoneypot] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileNonce, setTurnstileNonce] = useState(0);

  const mobileSearchRef = useRef<HTMLInputElement>(null);
  const fullNameInputRef = useRef<HTMLInputElement>(null);
  const ageInputRef = useRef<HTMLInputElement>(null);
  const emergencyNameInputRef = useRef<HTMLInputElement>(null);
  const emergencyPhoneInputRef = useRef<HTMLInputElement>(null);
  const errorAlertRef = useRef<HTMLDivElement>(null);
  const submitLockRef = useRef(false);
  const formOpenedAtRef = useRef(Date.now());

  useEffect(() => {
    if (showForm) {
      formOpenedAtRef.current = Date.now();
    }
  }, [showForm]);

  useAndroidBackHandler(Boolean(lightboxMedia), () => setLightboxMedia(null));
  useAndroidBackHandler(showForm && !saving, () => {
    setConfirmation(null);
    setShowForm(false);
  });
  useAndroidBackHandler(isCompact && mobileInspecting && !showForm && !lightboxMedia, () => {
    setMobileInspecting(false);
  });

  const inFormFlow = Boolean(showForm || confirmation || paymentReturn?.status === 'paid');
  useEffect(() => {
    onFormViewChange?.(inFormFlow);
  }, [inFormFlow, onFormViewChange]);

  useEffect(() => {
    onCanvasModeChange?.(Boolean(isCompact && mobileInspecting && !inFormFlow));
    return () => onCanvasModeChange?.(false);
  }, [isCompact, mobileInspecting, inFormFlow, onCanvasModeChange]);

  // Payment-provider return verification (webhook remains the authoritative writer).
  // Bounded to MAX_PAYMENT_POLLS attempts with exponential backoff and hidden-tab pause.
  useEffect(() => {
    const paymentId = new URLSearchParams(window.location.search).get('payment');
    if (!paymentId) return;
    const MAX_PAYMENT_POLLS = 24;
    let cancelled = false;
    let timeout: number | undefined;
    let attempts = 0;

    setPaymentPollTimedOut(false);

    const scheduleCheck = (delayMs: number) => {
      if (cancelled) return;
      timeout = window.setTimeout(() => {
        void check();
      }, delayMs);
    };

    const check = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        scheduleCheck(4000);
        return;
      }
      if (attempts >= MAX_PAYMENT_POLLS) {
        setCheckingPayment(false);
        setPaymentPollTimedOut(true);
        return;
      }
      attempts += 1;
      setCheckingPayment(true);
      try {
        const payment = await getPaymentStatus(paymentId);
        if (cancelled) return;
        setPaymentReturn(payment);
        setSelectedRaceId(payment.raceId);
        if (payment.status === 'paid') {
          window.history.replaceState({}, '', window.location.pathname);
          return;
        }
        if (payment.status === 'pending' || payment.status === 'creating') {
          if (attempts >= MAX_PAYMENT_POLLS) {
            setPaymentPollTimedOut(true);
            return;
          }
          const delayMs = computeBackoffMs(Math.floor(attempts / 4), {
            baseMs: 2500,
            maxMs: 12_000,
            jitterRatio: 0.15,
          });
          scheduleCheck(delayMs);
        }
      } catch (err: any) {
        if (!cancelled) {
          if (err instanceof PaymentRequestError && err.status === 429) {
            setPaymentPollTimedOut(true);
          }
          setError(err.message || 'We could not verify your payment yet. Please refresh in a moment.');
        }
      } finally {
        if (!cancelled) setCheckingPayment(false);
      }
    };

    void check();
    return () => {
      cancelled = true;
      if (timeout) window.clearTimeout(timeout);
    };
  }, [paymentCheckNonce]);

  const openRaces = useMemo(
    () => races.filter((race) => isRaceRegistrationOpen(race)).sort((a, b) => a.date.localeCompare(b.date)),
    [races],
  );

  const availableDistances = useMemo(() => {
    const labels = new Set<string>();
    openRaces.forEach((race) => sortedRaceDistances(race).forEach((d) => labels.add(d.label)));
    return Array.from(labels).sort((a, b) => {
      const na = parseFloat(a);
      const nb = parseFloat(b);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return NAME_COLLATOR.compare(a, b);
    });
  }, [openRaces]);

  const counts = useMemo(() => {
    const registered = openRaces.filter((race) => registeredRaceIds.has(race.id)).length;
    return {
      total: openRaces.length,
      registered,
      unjoined: openRaces.length - registered,
    };
  }, [openRaces, registeredRaceIds]);

  const filteredRaces = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    const list = openRaces.filter((race) => {
      const isJoined = registeredRaceIds.has(race.id);
      if (statusFilter === 'registered' && !isJoined) return false;
      if (statusFilter === 'unjoined' && isJoined) return false;
      if (distanceFilter !== 'all' && !(race.distances || []).some((d) => d.label === distanceFilter)) return false;
      if (needle) {
        const haystack = `${race.name} ${race.date} ${(race.distances || []).map((d) => d.label).join(' ')}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortKey === 'name') {
        const cmp = NAME_COLLATOR.compare(a.name, b.name);
        return cmp !== 0 ? cmp * dir : a.date.localeCompare(b.date);
      }
      if (sortKey === 'distances') {
        const cmp = (a.distances?.length || 0) - (b.distances?.length || 0);
        return cmp !== 0 ? cmp * dir : a.date.localeCompare(b.date);
      }
      if (sortKey === 'fee') {
        const minA = Math.min(0, ...(a.distances || []).map((d) => d.price || 0));
        const minB = Math.min(0, ...(b.distances || []).map((d) => d.price || 0));
        const maxA = Math.max(0, ...(a.distances || []).map((d) => d.price || 0));
        const maxB = Math.max(0, ...(b.distances || []).map((d) => d.price || 0));
        const cmp = (maxA || minA) - (maxB || minB);
        return cmp !== 0 ? cmp * dir : a.date.localeCompare(b.date);
      }
      const dateCmp = a.date.localeCompare(b.date);
      return dateCmp !== 0 ? dateCmp * dir : NAME_COLLATOR.compare(a.name, b.name);
    });
  }, [openRaces, registeredRaceIds, statusFilter, distanceFilter, searchQuery, sortKey, sortDir]);

  useEffect(() => {
    onMetricsChange?.({
      total: counts.total,
      unjoined: counts.unjoined,
      registered: counts.registered,
      showing: filteredRaces.length,
    });
  }, [counts.total, counts.unjoined, counts.registered, filteredRaces.length, onMetricsChange]);

  // Keep a valid active selection on desktop and sync deep links
  useEffect(() => {
    if (!requestedRaceId || !racesLoaded) return;
    const isOpenMatch = openRaces.some((r) => r.id === requestedRaceId);
    if (isOpenMatch) {
      setSelectedRaceId(requestedRaceId);
      setShowForm(false);
      setMobileInspecting(true);
      setDeepLinkNotice('');
    } else {
      const closedMatch = races.find((r) => r.id === requestedRaceId);
      setShowForm(false);
      setDeepLinkNotice(
        closedMatch
          ? `Registration for "${closedMatch.name}" is closed. Inspect its standings in All Races or choose an open event below.`
          : 'That race link is not available or registration has closed. Choose an open event below.',
      );
    }
    setError('');
    onRequestedRaceHandled?.();
  }, [onRequestedRaceHandled, openRaces, races, racesLoaded, requestedRaceId]);

  useEffect(() => {
    if (filteredRaces.length === 0) return;
    if (!filteredRaces.some((r) => r.id === selectedRaceId)) {
      setSelectedRaceId(filteredRaces[0].id);
    }
  }, [filteredRaces, selectedRaceId]);

  const selectedIndex = filteredRaces.findIndex((r) => r.id === selectedRaceId);
  const selectedRace = (selectedIndex >= 0 ? filteredRaces[selectedIndex] : openRaces.find((r) => r.id === selectedRaceId)) || undefined;
  const raceDistances = useMemo(() => (selectedRace ? sortedRaceDistances(selectedRace) : []), [selectedRace]);
  const availableEntryCategories: RaceEntryCategory[] = useMemo(
    () => (selectedRace ? raceEntryCategories(selectedRace) : ['solo']),
    [selectedRace],
  );
  const existingForRace = runnerProfiles.find((rp) => rp.raceId === selectedRace?.id);

  // Sync form fields whenever selectedRace changes
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
    } else {
      setFullName((curr) => curr || latest?.fullName || '');
      setGender(latest?.gender || 'male');
      setAge(latest?.age ? String(latest.age) : '');
      setEmergencyContactName(latest?.emergencyContactName || '');
      setEmergencyContactPhone(latest?.emergencyContactPhone || '');
      setShirtSize(initialShirtSize || latest?.shirtSize || '');
      setEntryCategory('solo');
      setTeamName('');
      setTeamMembers(['', '']);
    }
    setPaymentReference('');
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRace?.id]);

  useEffect(() => {
    if (existingForRace) {
      setDistance(existingForRace.distance);
    } else if (raceDistances.length > 0 && !raceDistances.some((d) => d.label === distance)) {
      setDistance(raceDistances[0].label);
    } else if (raceDistances.length === 0 && distance !== 'Custom') {
      setDistance('Custom');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRace?.id, raceDistances.length]);

  useEffect(() => {
    if (!availableEntryCategories.includes(entryCategory)) {
      setEntryCategory(availableEntryCategories[0] || 'solo');
    }
  }, [availableEntryCategories, entryCategory]);

  // Keyboard shortcuts matching MyRaceEventsPanel: `/` focuses search, ArrowUp/ArrowDown step events
  useEffect(() => {
    if (inFormFlow || lightboxMedia) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isFormField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;
      if (event.key === '/' && !isFormField && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        (isDesktop ? desktopSearchRef?.current : mobileSearchRef.current)?.focus();
        return;
      }
      if (!isFormField && filteredRaces.length > 1) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          const nextIdx = selectedIndex === -1 ? 0 : (selectedIndex + 1) % filteredRaces.length;
          setSelectedRaceId(filteredRaces[nextIdx].id);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          const prevIdx = selectedIndex === -1 ? 0 : (selectedIndex - 1 + filteredRaces.length) % filteredRaces.length;
          setSelectedRaceId(filteredRaces[prevIdx].id);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inFormFlow, lightboxMedia, isDesktop, desktopSearchRef, filteredRaces, selectedIndex]);

  const stepSelectedRace = (delta: -1 | 1) => {
    if (filteredRaces.length === 0) return;
    if (selectedIndex === -1) {
      setSelectedRaceId(filteredRaces[0].id);
      return;
    }
    const nextIdx = (selectedIndex + delta + filteredRaces.length) % filteredRaces.length;
    setSelectedRaceId(filteredRaces[nextIdx].id);
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'name' || key === 'date' ? 'asc' : 'desc');
  };

  const renderSortMarker = (column: SortKey) => {
    if (sortKey !== column) return null;
    return (
      <span className="ml-1 font-mono text-red-700 dark:text-red-400" aria-hidden="true">
        {sortDir === 'asc' ? '↑' : '↓'}
      </span>
    );
  };

  const openLegalDoc = (legalDoc: LegalDocKey) => {
    window.dispatchEvent(new CustomEvent('racepulse:open-legal', { detail: legalDoc }));
  };

  const failValidation = (message: string, targetRef?: React.RefObject<HTMLInputElement | null>) => {
    setError(message);
    window.requestAnimationFrame(() => {
      if (targetRef?.current) {
        targetRef.current.focus();
      } else {
        errorAlertRef.current?.focus();
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current) return;
    if (!can('personal.register')) return failValidation('Registration is disabled for your account.');
    setError('');
    if (!fullName.trim()) return failValidation('Please enter your full name.', fullNameInputRef);
    if (!selectedRace) return failValidation('Please select which race you are registering for.');
    const parsedAge = parseInt(age, 10);
    if (!age || Number.isNaN(parsedAge) || parsedAge < 1 || parsedAge > 120) {
      return failValidation('Please enter a valid age between 1 and 120.', ageInputRef);
    }
    if (parsedAge < 13) {
      if (!parentGuardianName.trim()) {
        return failValidation('Enter the parent or legal guardian full name for participants under 13.');
      }
      if (!parentGuardianRelationship.trim()) {
        return failValidation('Specify the guardian relationship (e.g., Mother, Father, Legal Guardian).');
      }
      if (!parentalConsentConfirmed) {
        return failValidation('Verifiable parental or legal guardian consent is required for participants under 13.');
      }
    }
    if (!emergencyContactName.trim()) {
      return failValidation('Please enter an emergency contact person.', emergencyNameInputRef);
    }
    if (emergencyContactPhone.trim().length < 4) {
      return failValidation('Please enter a valid emergency contact number.', emergencyPhoneInputRef);
    }
    if (!acceptedRegistrationTerms) {
      return failValidation('Please accept the Terms of Service, Privacy Policy, Refund Policy, and Cookie Policy before submitting.');
    }

    const termsAcceptedAt = existingForRace?.termsAcceptedAt || new Date().toISOString();
    const finalDistance = distance === 'Custom' ? customDistance || 'Custom Run' : distance;
    const memberCount = entryMemberCount[entryCategory];
    const normalizedMembers =
      entryCategory === 'solo'
        ? [fullName.trim()]
        : [fullName.trim(), ...teamMembers.slice(1, memberCount).map((member) => member.trim())];
    if (entryCategory !== 'solo' && !teamName.trim()) return failValidation('Please enter your team name.');
    if (normalizedMembers.some((member) => !member)) {
      return failValidation(`Enter all ${memberCount} ${entryCategoryLabels[entryCategory]} member names.`);
    }

    const selectedDistance = raceDistances.find((item) => item.label === distance);
    const shouldPayOnline = !existingForRace && !!selectedRace.onlinePaymentEnabled && (selectedDistance?.price || 0) > 0;
    const shouldUseManualPayment = !existingForRace && !!selectedRace.manualPaymentEnabled && (selectedDistance?.price || 0) > 0;
    if (shouldUseManualPayment && paymentReference.trim().length < 4) {
      return failValidation('Enter the payment reference number from your GCash or bank transaction.');
    }

    submitLockRef.current = true;
    setSaving(true);
    try {
      if (shouldPayOnline) {
        const signals = buildHumanFormSignals(honeypot, formOpenedAtRef.current, turnstileToken);
        const checkout = await createPayMongoCheckout({
          raceId: selectedRace.id,
          distance: finalDistance,
          entryCategory,
          fullName: entryCategory === 'solo' ? fullName.trim().toUpperCase() : teamName.trim().toUpperCase(),
          gender,
          age: parsedAge,
          emergencyContactName: emergencyContactName.trim().toUpperCase(),
          emergencyContactPhone: emergencyContactPhone.trim(),
          ...(parsedAge < 13
            ? {
                parentalConsentConfirmed: true,
                parentGuardianName: parentGuardianName.trim().toUpperCase(),
                parentGuardianRelationship: parentGuardianRelationship.trim().toUpperCase(),
              }
            : {}),
          termsAcceptedAt,
          marketingOptIn,
          ...(shirtSize ? { shirtSize } : {}),
          ...(entryCategory !== 'solo'
            ? {
                teamName: teamName.trim().toUpperCase(),
                teamMembers: normalizedMembers.map((member) => member.toUpperCase()),
              }
            : {}),
        }, signals);
        window.location.assign(checkout.checkoutUrl);
        return;
      }

      const selectedDistanceKm = selectedDistance?.km ?? null;
      const buildRecord = (bibNumber: string): RunnerProfile => ({
        uid,
        raceId: selectedRace.id,
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
        ...(parsedAge < 13
          ? {
              parentalConsentConfirmed: true,
              parentalGuardianName: parentGuardianName.trim().toUpperCase(),
              parentGuardianRelationship: parentGuardianRelationship.trim().toUpperCase(),
            }
          : {}),
        ...(existingForRace?.chipId ? { chipId: existingForRace.chipId } : {}),
        ...(existingForRace?.kitClaimedAt ? { kitClaimedAt: existingForRace.kitClaimedAt } : {}),
        ...(shirtSize ? { shirtSize } : {}),
        ...(entryCategory !== 'solo'
          ? {
              teamName: teamName.trim().toUpperCase(),
              teamMembers: normalizedMembers.map((member) => member.toUpperCase()),
            }
          : {}),
        ...(shouldUseManualPayment
          ? {
              paymentStatus: 'pending' as const,
              paymentMethod: 'manual',
              paymentAmount: selectedDistance!.price,
              paymentReference: paymentReference.trim().toUpperCase(),
            }
          : {}),
      });

      const runnerRef = doc(db, 'runners', `${uid}_${selectedRace.id}`);
      let record: RunnerProfile;
      if (existingForRace) {
        record = buildRecord(existingForRace.bibNumber);
        await setDoc(runnerRef, record, { merge: true });
      } else {
        const counterRef = doc(db, 'bibCounters', bibCounterDocId(selectedRace.id, finalDistance, entryCategory));
        record = await runTransaction(db, async (tx) => {
          const [existingSnap, counterSnap] = await Promise.all([
            tx.get(runnerRef),
            tx.get(counterRef),
          ]);
          if (existingSnap.exists()) {
            const existingBib = String(existingSnap.data().bibNumber || '');
            const merged = buildRecord(existingBib || formatGeneratedBib(selectedDistanceKm, entryCategory, 1));
            tx.set(runnerRef, merged, { merge: true });
            return merged;
          }
          const next = (counterSnap.exists() ? Number(counterSnap.data().count || 0) : 0) + 1;
          const nextBib = formatGeneratedBib(selectedDistanceKm, entryCategory, next);
          const created = buildRecord(nextBib);
          tx.set(counterRef, { count: next, raceId: selectedRace.id });
          tx.set(runnerRef, created);
          return created;
        });
      }
      setConfirmation({ registration: record, wasUpdate: !!existingForRace });
    } catch (err: any) {
      if (shouldPayOnline) setTurnstileNonce((n) => n + 1);
      failValidation(err.message || 'Failed to save your race profile.');
    } finally {
      submitLockRef.current = false;
      setSaving(false);
    }
  };

  if (confirmation) {
    const confirmedRace = races.find((race) => race.id === confirmation.registration.raceId);
    return (
      <RegistrationConfirmation
        race={confirmedRace}
        registration={confirmation.registration}
        updated={confirmation.wasUpdate}
        onViewMyRace={onSaved}
        onRegisterAnother={() => {
          setConfirmation(null);
          setShowForm(false);
          setMobileInspecting(false);
          setError('');
        }}
      />
    );
  }

  if (paymentReturn?.status === 'paid') {
    return (
      <div className="max-w-xl mx-auto px-3 sm:px-4 py-3 space-y-4">
        <RegistrationProgress currentStep={3} />
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 sm:p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-full mx-auto bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="w-7 h-7" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold font-display uppercase text-[var(--text-primary)]">
              Race registration confirmed
            </h2>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400 mt-1">
              Payment verified
            </p>
            <p className="text-xs text-[var(--text-secondary)] mt-1.5">
              Your PayMongo payment was confirmed securely. Your race pass is ready in My Passes.
            </p>
          </div>
          <button
            type="button"
            onClick={onSaved}
            className="min-h-11 w-full py-2.5 rounded-xl font-display font-semibold uppercase text-xs tracking-widest text-white bg-red-700 hover:bg-red-600 transition"
          >
            View My Passes
          </button>
        </div>
      </div>
    );
  }

  if (showForm && selectedRace) {
    const selectedDistanceObj = raceDistances.find((item) => item.label === distance);
    const entryFee = selectedDistanceObj?.price || 0;
    const passedOnFee = selectedRace.onlinePaymentEnabled && selectedRace.paymentFeeMode === 'passed_on';

    return (
      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3 pb-32 min-[600px]:pb-6 space-y-4">
        <RegistrationProgress currentStep={2} raceName={selectedRace.name} />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-7 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-3 sm:p-5 space-y-4">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="min-h-11 py-1 text-xs font-semibold text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 inline-flex items-center gap-2 transition"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to Event Details
            </button>

            <div>
              <h2 className="text-base sm:text-lg font-semibold font-display uppercase tracking-tight text-[var(--text-primary)]">
                {existingForRace ? 'Update Registration for' : 'Register for'} {selectedRace.name}
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Links your account to your race bib so organizers can record your checkpoint splits.
              </p>
            </div>

            <form id="runner-registration-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
              <fieldset className="contents" disabled={!can('personal.register')}>
                <div>
                  <label
                    htmlFor="reg-full-name"
                    className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2"
                  >
                    Full Name <span className="text-red-700 dark:text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <User
                      className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      ref={fullNameInputRef}
                      id="reg-full-name"
                      type="text"
                      required
                      autoComplete="name"
                      aria-invalid={Boolean(error && !fullName.trim())}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value.toUpperCase())}
                      className="w-full min-h-11 glass-inset pl-10 pr-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
                      placeholder="EX: JUAN DELA CRUZ"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="reg-distance"
                    className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2"
                  >
                    Race Distance
                  </label>
                  {existingForRace ? (
                    <div className="glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                      <span>{existingForRace.distance}</span>
                    </div>
                  ) : (
                    <Select
                      id="reg-distance"
                      value={distance}
                      onChange={setDistance}
                      leadingIcon={<MapPin className="w-4 h-4" aria-hidden="true" />}
                      surface="inset"
                      size="md"
                      options={[
                        ...raceDistances.map((d) => ({
                          value: d.label,
                          label: `${d.label}${d.price > 0 ? ` (PHP ${d.price.toFixed(0)})` : ''}`,
                        })),
                        { value: 'Custom', label: 'Custom Distance...' },
                      ]}
                    />
                  )}
                  {!existingForRace && raceDistances.length === 0 && (
                    <p className="text-xs text-[var(--text-secondary)] mt-2 pl-1">
                      This race has no preset distances yet. Enter your distance label below.
                    </p>
                  )}
                </div>

                {!existingForRace && distance === 'Custom' && (
                  <div>
                    <label
                      htmlFor="reg-custom-distance"
                      className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2"
                    >
                      Custom Distance Label
                    </label>
                    <input
                      id="reg-custom-distance"
                      type="text"
                      required
                      value={customDistance}
                      onChange={(e) => setCustomDistance(e.target.value.toUpperCase())}
                      className="w-full min-h-11 glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
                      placeholder="EX: 15K TRAIL RUN"
                    />
                  </div>
                )}

                <div>
                  <span className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                    Entry Category
                  </span>
                  {existingForRace ? (
                    <div className="glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                      <Users2 className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                      <span>{entryCategoryLabels[runnerEntryCategory(existingForRace)]}</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-label="Entry category">
                      {availableEntryCategories.map((category) => (
                        <button
                          key={category}
                          type="button"
                          onClick={() => setEntryCategory(category)}
                          aria-pressed={entryCategory === category}
                          className={`min-h-11 rounded-xl border px-3 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                            entryCategory === category
                              ? 'border-red-600 bg-red-600/10 text-red-700 dark:text-red-400'
                              : 'border-[var(--border-default)] glass-inset text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          {entryCategoryLabels[category]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {entryCategory !== 'solo' && (
                  <div className="glass-inset p-4 space-y-3">
                    <div>
                      <label
                        htmlFor="reg-team-name"
                        className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2"
                      >
                        {entryCategoryLabels[entryCategory]} Team Name
                      </label>
                      <input
                        id="reg-team-name"
                        type="text"
                        required
                        value={teamName}
                        onChange={(e) => setTeamName(e.target.value.toUpperCase())}
                        className="w-full min-h-11 glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
                        placeholder="EX: TEAM RACEPULSE"
                      />
                    </div>
                    {Array.from({ length: entryMemberCount[entryCategory] }).map((_, index) => {
                      const memberId = `reg-team-member-${index + 1}`;
                      return (
                        <div key={index}>
                          <label
                            htmlFor={memberId}
                            className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2"
                          >
                            Member {index + 1}
                            {index === 0 ? ' / Team Captain' : ''}
                          </label>
                          <input
                            id={memberId}
                            type="text"
                            required
                            value={index === 0 ? fullName : teamMembers[index] || ''}
                            onChange={(e) => {
                              const value = e.target.value.toUpperCase();
                              if (index === 0) setFullName(value);
                              else
                                setTeamMembers((current) => {
                                  const next = [...current];
                                  next[index] = value;
                                  return next;
                                });
                            }}
                            className="w-full min-h-11 glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
                            placeholder={`FULL NAME OF MEMBER ${index + 1}`}
                          />
                        </div>
                      );
                    })}
                    <p className="text-xs text-[var(--text-secondary)]">
                      One shared bib and timing chip is assigned to this team. Your result is ranked against{' '}
                      {entryCategoryLabels[entryCategory]} teams only.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="reg-gender"
                      className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2"
                    >
                      Gender
                    </label>
                    <Select
                      id="reg-gender"
                      value={gender}
                      onChange={(value) => setGender(value as Gender)}
                      surface="inset"
                      size="md"
                      options={[
                        { value: 'male', label: 'Male' },
                        { value: 'female', label: 'Female' },
                      ]}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="reg-age"
                      className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2"
                    >
                      Age <span className="text-red-700 dark:text-red-400">*</span>
                    </label>
                    <input
                      ref={ageInputRef}
                      id="reg-age"
                      type="number"
                      inputMode="numeric"
                      required
                      min={1}
                      max={120}
                      value={age}
                      onChange={(e) => setAge(e.target.value)}
                      className="w-full min-h-11 glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
                      placeholder="EX: 27"
                    />
                  </div>
                </div>
                <p className="text-xs text-[var(--text-secondary)] mt-1.5 pb-1">
                  Used to place the athlete in the correct age category on race reports.
                </p>

                {age !== '' && !Number.isNaN(Number(age)) && Number(age) < 13 && (
                  <div className="rounded-xl border border-amber-600/40 bg-amber-500/10 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-300">
                      <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                      Verifiable Parental Consent (Under 13 / COPPA &amp; GDPR-K)
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                      This participant is under 13 years old. A parent or legal guardian aged 18 or older must authorize this
                      race entry and the publication of event timing records.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="reg-guardian-name"
                          className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2"
                        >
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
                          className="w-full min-h-11 glass-inset px-4 py-2 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="reg-guardian-rel"
                          className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2"
                        >
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
                          className="w-full min-h-11 glass-inset px-4 py-2 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
                        />
                      </div>
                    </div>
                    <div className="flex items-start gap-2 pt-1">
                      <input
                        id="reg-parental-consent"
                        type="checkbox"
                        checked={parentalConsentConfirmed}
                        onChange={(e) => setParentalConsentConfirmed(e.target.checked)}
                        className="rp-checkbox shrink-0"
                      />
                      <div className="pt-2 text-xs text-[var(--text-primary)] leading-relaxed flex-1 min-w-0 space-y-2">
                        <label htmlFor="reg-parental-consent" className="cursor-pointer block">
                          I certify that I am the parent or legal guardian (aged 18+) of this minor participant and grant
                          verifiable parental consent for race participation, emergency contact use, and event timing under the
                          Privacy Policy.
                        </label>
                        <div>
                          <a
                            href="/privacy-policy"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!isClientNavigationClick(e)) return;
                              e.preventDefault();
                              openLegalDoc('privacy');
                            }}
                            className="inline-flex items-center whitespace-nowrap min-h-8 px-2 py-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] text-xs font-semibold text-red-700 dark:text-red-400 underline underline-offset-2 hover:border-red-600/50 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                          >
                            Read Privacy Policy
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="glass-inset p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    <HeartPulse className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                    Emergency Contact
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] -mt-1">
                    Collected strictly for race-day medical emergency response by authorized organizers.
                  </p>
                  <div>
                    <label
                      htmlFor="reg-emergency-name"
                      className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2"
                    >
                      Contact Person <span className="text-red-700 dark:text-red-400">*</span>
                    </label>
                    <input
                      ref={emergencyNameInputRef}
                      id="reg-emergency-name"
                      type="text"
                      required
                      value={emergencyContactName}
                      onChange={(e) => setEmergencyContactName(e.target.value.toUpperCase())}
                      maxLength={100}
                      className="w-full min-h-11 glass-inset px-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
                      placeholder="EX: MARIA DELA CRUZ (MOTHER)"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="reg-emergency-phone"
                      className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2"
                    >
                      Contact Number <span className="text-red-700 dark:text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <Phone
                        className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none"
                        aria-hidden="true"
                      />
                      <input
                        ref={emergencyPhoneInputRef}
                        id="reg-emergency-phone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        required
                        value={emergencyContactPhone}
                        onChange={(e) => setEmergencyContactPhone(e.target.value)}
                        maxLength={30}
                        className="w-full min-h-11 glass-inset pl-10 pr-4 py-3 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400"
                        placeholder="EX: 0917 123 4567"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="reg-shirt-size"
                    className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2"
                  >
                    Shirt Size{' '}
                    <span className="normal-case font-normal text-[var(--text-secondary)]">
                      (optional unless included with race kit)
                    </span>
                  </label>
                  <ShirtSizePicker
                    id="reg-shirt-size"
                    key={`${selectedRace.id}_${existingForRace?.shirtSize || initialShirtSize || ''}`}
                    value={shirtSize}
                    onChange={setShirtSize}
                    emptyLabel="Select shirt size"
                  />
                  <p className="text-xs text-[var(--text-secondary)] mt-2 pl-1">
                    Shared only with the kit desk for size allocation.
                  </p>
                </div>

                {!existingForRace && selectedRace.onlinePaymentEnabled && entryFee > 0 && (
                  <p className="text-xs text-emerald-800 dark:text-emerald-300 border border-emerald-500/30 bg-emerald-500/10 rounded-xl px-3 py-2 flex items-center gap-2">
                    <Coins className="w-4 h-4 shrink-0" aria-hidden="true" />
                    Secure checkout: GCash, Maya, QRPh, or card. Your registration is confirmed only after payment
                    verification.
                  </p>
                )}

                {!existingForRace && selectedRace.manualPaymentEnabled && entryFee > 0 && (
                  <div className="text-xs text-amber-900 dark:text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded-xl px-4 py-3 space-y-2">
                    <p className="font-semibold">Manual payment · PHP {entryFee.toFixed(2)}</p>
                    <p className="text-[var(--text-secondary)] whitespace-pre-line">
                      {selectedRace.manualPaymentInstructions ||
                        'Submit your registration, then follow the organizer payment instructions. Your bib will be reserved pending verification.'}
                    </p>
                    {selectedRace.manualPaymentQrImage && (
                      <div className="pt-2 text-center">
                        <p className="text-xs font-semibold uppercase tracking-widest text-amber-900 dark:text-amber-300 mb-2">
                          Scan to pay
                        </p>
                        <img
                          src={selectedRace.manualPaymentQrImage}
                          alt="GCash or QRPh payment code"
                          className="mx-auto w-48 max-w-full rounded-xl bg-white p-2 shadow-sm"
                        />
                      </div>
                    )}
                    <div>
                      <label
                        htmlFor="reg-payment-ref"
                        className="block text-xs font-semibold uppercase tracking-widest text-amber-900 dark:text-amber-300 mb-2"
                      >
                        Payment reference number <span className="text-red-700 dark:text-red-400">required</span>
                      </label>
                      <input
                        id="reg-payment-ref"
                        type="text"
                        required
                        value={paymentReference}
                        onChange={(event) => setPaymentReference(event.target.value.toUpperCase())}
                        maxLength={100}
                        autoCapitalize="characters"
                        autoCorrect="off"
                        placeholder="GCash / bank transaction reference"
                        className="w-full min-h-11 glass-inset px-3 py-2 text-sm font-mono font-semibold tracking-wide text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                      />
                      <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                        Used solely to reconcile your transfer. A screenshot is not required.
                      </p>
                    </div>
                  </div>
                )}

                {(checkingPayment || ((paymentReturn?.status === 'pending' || paymentReturn?.status === 'creating') && !paymentPollTimedOut)) && (
                  <p className="text-xs text-amber-900 dark:text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded-xl px-3 py-2 flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 motion-safe:animate-spin shrink-0" aria-hidden="true" />
                    Verifying your PayMongo payment securely...
                  </p>
                )}

                {paymentPollTimedOut && (paymentReturn?.status === 'pending' || paymentReturn?.status === 'creating') && (
                  <div
                    role="status"
                    className="text-xs text-amber-900 dark:text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded-xl px-3 py-2.5 flex flex-wrap items-center justify-between gap-2"
                  >
                    <span>Confirmation is taking longer than expected. Refresh once your payment finishes.</span>
                    <button
                      type="button"
                      disabled={checkingPayment}
                      onClick={() => setPaymentCheckNonce((n) => n + 1)}
                      className="min-h-9 px-3 rounded-lg border border-amber-600/40 bg-amber-500/15 font-semibold hover:bg-amber-500/25 transition-colors"
                    >
                      Refresh status
                    </button>
                  </div>
                )}

                {(paymentReturn?.status === 'failed' || paymentReturn?.status === 'expired') && (
                  <p
                    role="alert"
                    className="text-xs text-red-700 dark:text-red-400 border border-red-500/30 bg-red-500/10 rounded-xl px-3 py-2"
                  >
                    Your checkout was not completed. No registration or charge was created; you may retry payment anytime.
                  </p>
                )}

                <div
                  aria-hidden="true"
                  style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}
                >
                  <label htmlFor="reg-company-website">Leave blank</label>
                  <input
                    id="reg-company-website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                  />
                </div>

                {!existingForRace && selectedRace.onlinePaymentEnabled && entryFee > 0 && (
                  <TurnstileChallenge action="checkout" resetNonce={turnstileNonce} onToken={setTurnstileToken} />
                )}

                <div className="glass-inset p-4 space-y-3 rounded-xl">
                  <div className="flex items-start gap-2">
                    <input
                      id="reg-terms-consent"
                      type="checkbox"
                      checked={acceptedRegistrationTerms}
                      onChange={(e) => setAcceptedRegistrationTerms(e.target.checked)}
                      className="rp-checkbox shrink-0"
                    />
                    <div className="pt-2 text-xs text-[var(--text-primary)] leading-relaxed flex-1 min-w-0">
                      <label htmlFor="reg-terms-consent" className="cursor-pointer block">
                        I accept the Terms of Service, Privacy Policy, Refund Policy, and Cookie Policy for this event
                        registration, including official timing and public leaderboard publication.
                      </label>
                      <div className="flex flex-wrap items-center gap-2 pt-2" role="group" aria-label="Event legal and cookie policies">
                        {(
                          [
                            { docKey: 'terms', href: '/terms-of-service', label: 'Terms of Service' },
                            { docKey: 'privacy', href: '/privacy-policy', label: 'Privacy Policy' },
                            { docKey: 'refund', href: '/refund-policy', label: 'Refund Policy' },
                            { docKey: 'cookies', href: '/cookie-policy', label: 'Cookie Policy' },
                          ] as const
                        ).map((item) => (
                          <a
                            key={item.docKey}
                            href={item.href}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!isClientNavigationClick(e)) return;
                              e.preventDefault();
                              openLegalDoc(item.docKey);
                            }}
                            className="inline-flex items-center whitespace-nowrap min-h-8 px-2 py-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] text-xs font-semibold text-red-700 dark:text-red-400 underline underline-offset-2 hover:border-red-600/50 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                          >
                            {item.label}
                          </a>
                        ))}
                      </div>
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
                      Send me optional announcements about future runs and post-race certificates (optional, unsubscribe
                      anytime).
                    </span>
                  </label>
                </div>

                {error && (
                  <div
                    ref={errorAlertRef}
                    tabIndex={-1}
                    role="alert"
                    className="rounded-xl border border-red-600/35 bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-400 font-semibold flex items-start gap-2 focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                )}

                {(isSplitPane || imeOpen) && (
                  <button
                    type="submit"
                    disabled={saving}
                    className="min-h-12 w-full py-3 px-6 rounded-xl font-display font-semibold uppercase text-xs tracking-widest flex items-center justify-center gap-2 transition text-white bg-red-700 hover:bg-red-600 disabled:opacity-60 tabular-nums"
                  >
                    {saving ? (
                      <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />
                    ) : (
                      <ClipboardList className="w-4 h-4" aria-hidden="true" />
                    )}
                    <span>
                      {existingForRace
                        ? 'Update Registration'
                        : selectedRace.onlinePaymentEnabled && entryFee > 0
                          ? `Continue to checkout (PHP ${entryFee.toFixed(2)})`
                          : selectedRace.manualPaymentEnabled && entryFee > 0
                            ? `Reserve slot (PHP ${entryFee.toFixed(2)})`
                            : 'Save Race Registration'}
                    </span>
                  </button>
                )}
              </fieldset>
            </form>
          </div>

          <aside className="lg:col-span-5 rounded-xl border border-[var(--border-default)] border-l-4 border-l-red-600 bg-[var(--surface-card)] p-3 sm:p-5 space-y-3 lg:sticky lg:top-20">
            <div className="flex items-start justify-between gap-3 pb-2.5 border-b border-[var(--border-subtle)]">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Registration Summary
                </p>
                <h3 className="text-base font-display font-semibold text-[var(--text-primary)] truncate mt-0.5">
                  {selectedRace.name}
                </h3>
                <p className="text-xs font-mono tabular-nums text-[var(--text-secondary)] mt-0.5">{selectedRace.date}</p>
              </div>
              <span className="shrink-0 px-2.5 py-0.5 rounded-full border border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-semibold tabular-nums">
                {existingForRace ? `Bib #${existingForRace.bibNumber}` : 'Open'}
              </span>
            </div>

            <div className="border-b border-[var(--border-subtle)] pb-2.5 text-xs flex items-start gap-2 text-[var(--text-secondary)]">
              <Hash className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                {existingForRace
                  ? `Your official bib number remains #${existingForRace.bibNumber}.`
                  : 'Your bib number is assigned automatically by distance sequence upon confirmation (for example, first 5K solo gets 5-001).'}
              </span>
            </div>

            {!existingForRace && entryFee > 0 && (
              <div className="border-b border-[var(--border-subtle)] pb-3 space-y-2.5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-2">
                  <Coins className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                  Upfront Cost, Tax, and Cancellation Summary
                </h4>
                <dl className="divide-y divide-[var(--border-subtle)] text-xs">
                  <div className="py-1.5 flex items-center justify-between gap-4">
                    <dt className="text-[var(--text-secondary)]">Entry fee ({distance})</dt>
                    <dd className="font-mono font-semibold tabular-nums text-[var(--text-primary)]">
                      PHP {entryFee.toFixed(2)}
                    </dd>
                  </div>
                  <div className="py-1.5 flex items-center justify-between gap-4">
                    <dt className="text-[var(--text-secondary)]">RacePulsePH platform surcharge</dt>
                    <dd className="font-semibold tabular-nums text-[var(--text-primary)]">PHP 0.00 (No hidden fees)</dd>
                  </div>
                  <div className="py-1.5 flex items-start justify-between gap-4">
                    <dt className="text-[var(--text-secondary)] shrink-0">Gateway processing &amp; taxes</dt>
                    <dd className="text-right text-[var(--text-secondary)]">
                      {selectedRace.onlinePaymentEnabled
                        ? passedOnFee
                          ? 'Applicable taxes included; PayMongo gateway fee itemized on checkout screen before final confirmation.'
                          : 'Applicable taxes and PayMongo gateway fee absorbed by organizer (PHP 0.00 surcharge).'
                        : 'No online gateway fee added (direct transfer per organizer instructions).'}
                    </dd>
                  </div>
                  <div className="py-1.5 flex items-center justify-between gap-4">
                    <dt className="text-[var(--text-secondary)]">Billing schedule</dt>
                    <dd className="font-semibold text-[var(--text-primary)]">One-time charge (no subscription)</dd>
                  </div>
                </dl>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed pt-1">
                  Cancellation &amp; refunds: Full refund if organizer cancels. Runner cancellations follow our{' '}
                  <a
                    href="/refund-policy"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!isClientNavigationClick(event)) return;
                      event.preventDefault();
                      openLegalDoc('refund');
                    }}
                    className="inline-flex items-center min-h-7 py-0.5 font-semibold text-red-700 dark:text-red-400 underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                  >
                    Refund Policy
                  </a>{' '}
                  (100% at 14+ days before race day unless organizer terms state otherwise).
                </p>
              </div>
            )}

            {friendIdentity?.username && can('personal.invites') && (
              <InviteFriendsToRace uid={uid} senderName={friendIdentity.displayName} race={selectedRace} />
            )}

            <EventCourseRunnerPanel
              race={selectedRace}
              preferredDistance={distance !== 'Custom' ? distance : customDistance}
              compact
            />
          </aside>
        </div>

        {!isSplitPane && (
          <RunnerThumbActionBar hidden={imeOpen}>
            <button
              type="submit"
              form="runner-registration-form"
              disabled={saving || !can('personal.register')}
              className="min-h-11 w-full px-4 rounded-xl font-display font-semibold uppercase text-xs tracking-wider flex items-center justify-center gap-2 transition text-white bg-red-700 hover:bg-red-600 disabled:opacity-60 tabular-nums"
            >
              {saving ? (
                <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />
              ) : (
                <ClipboardList className="w-4 h-4" aria-hidden="true" />
              )}
              <span>
                {existingForRace
                  ? 'Update Registration'
                  : selectedRace.onlinePaymentEnabled && entryFee > 0
                    ? `Checkout (PHP ${entryFee.toFixed(2)})`
                    : selectedRace.manualPaymentEnabled && entryFee > 0
                      ? `Reserve Slot (PHP ${entryFee.toFixed(2)})`
                      : 'Save Registration'}
              </span>
            </button>
          </RunnerThumbActionBar>
        )}
      </div>
    );
  }

  const showCompactCanvas = Boolean(isCompact && mobileInspecting && selectedRace);

  return (
    <>
      {showCompactCanvas && selectedRace ? (
        <OpenEventCanvasView
          uid={uid}
          race={selectedRace}
          raceDistances={raceDistances}
          existingForRace={existingForRace}
          preferredDistance={distanceFilter !== 'all' ? distanceFilter : distance}
          canRegister={can('personal.register')}
          canInvite={can('personal.invites')}
          friendIdentity={friendIdentity}
          onStartForm={() => setShowForm(true)}
          onBrowseAllRaces={onBrowseAllRaces}
          onOpenLightbox={setLightboxMedia}
          onBack={() => setMobileInspecting(false)}
        />
      ) : (
        <div id="runner_events_directory_main" className="w-full flex flex-col flex-1 min-h-0 min-[600px]:overflow-hidden">
          {deepLinkNotice && (
            <div
              role="alert"
              className="shrink-0 mx-3 mt-2 mb-1 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-900 dark:text-amber-300 flex items-center justify-between gap-2"
            >
              <span className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{deepLinkNotice}</span>
              </span>
              <button
                type="button"
                onClick={() => setDeepLinkNotice('')}
                aria-label="Dismiss registration notice"
                className="min-h-11 min-w-11 lg:min-h-8 lg:min-w-8 rounded-lg inline-flex items-center justify-center shrink-0 hover:bg-amber-500/15"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Master-Detail Split Workspace */}
          <div className="flex-1 min-h-0 flex flex-col min-[600px]:grid min-[600px]:grid-cols-[minmax(236px,38%)_minmax(0,1fr)] min-[920px]:grid-cols-[340px_minmax(0,1fr)] lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
            <section
              aria-label="Open race events directory"
              className="flex flex-col flex-1 min-h-0 bg-[var(--surface-page)] min-[600px]:border-r min-[600px]:border-[var(--border-default)] overflow-hidden"
            >
              {!isDesktop && (
                <RunnerFilterRail<OpenEventsFilter>
                  ariaLabel="Filter open events"
                  options={[
                    { key: 'all', label: 'All', count: counts.total },
                    { key: 'unjoined', label: 'Open', count: counts.unjoined },
                    { key: 'registered', label: 'Joined', count: counts.registered },
                  ]}
                  value={statusFilter}
                  onChange={onStatusFilterChange}
                  searchValue={searchQuery}
                  onSearchChange={onSearchQueryChange}
                  searchPlaceholder="Search race, date, distance..."
                  searchLabel="Search open events by name, date, or distance"
                  searchInputId="runner_events_mobile_search"
                  searchInputRef={mobileSearchRef}
                />
              )}

              <div
                tabIndex={0}
                role="region"
                aria-label="Open events list"
                className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto overscroll-y-contain rp-runner-scroll"
              >
                {availableDistances.length > 0 && (
                  <div className="px-3 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--surface-card)] flex items-center gap-1.5 overflow-x-auto racepulse-horizontal-scroll touch-pan-x">
                    <span className="text-xs font-semibold text-[var(--text-secondary)] whitespace-nowrap shrink-0">
                      Distance:
                    </span>
                    <button
                      type="button"
                      onClick={() => setDistanceFilter('all')}
                      aria-pressed={distanceFilter === 'all'}
                      className={`min-h-11 min-w-11 min-[600px]:min-h-8 min-[600px]:min-w-0 px-3 rounded-lg border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                        distanceFilter === 'all'
                          ? 'border-red-600 bg-red-700 text-white'
                          : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600'
                      }`}
                    >
                      All
                    </button>
                    {availableDistances.map((label) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setDistanceFilter(label)}
                        aria-pressed={distanceFilter === label}
                        className={`min-h-11 min-w-11 min-[600px]:min-h-8 min-[600px]:min-w-0 px-3 rounded-lg border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                          distanceFilter === label
                            ? 'border-red-600 bg-red-700 text-white'
                            : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-red-600'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                {!racesLoaded ? (
                  <RunnerQueueSkeleton rows={5} label="Loading open events" />
                ) : racesError ? (
                  <div role="alert" className="flex flex-col items-center justify-center py-10 px-3 text-center">
                    <AlertTriangle className="w-6 h-6 text-red-700 dark:text-red-400 mb-2" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Unable to load open events</h3>
                    <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">{racesError}</p>
                  </div>
                ) : openRaces.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 px-3 text-center">
                    <LayoutGrid className="w-7 h-7 text-[var(--text-secondary)] mb-2" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                      No races are open for registration right now
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">
                      Browse All Races to inspect upcoming schedules, past results, and finisher certificates.
                    </p>
                    <button
                      type="button"
                      onClick={onBrowseAllRaces}
                      className="mt-3 min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-2"
                    >
                      <Trophy className="w-4 h-4" aria-hidden="true" />
                      <span>Browse All Races</span>
                    </button>
                  </div>
                ) : filteredRaces.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 px-3 text-center">
                    <Search className="w-6 h-6 text-[var(--text-secondary)] mb-2" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">No matching open events</h3>
                    <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm">
                      Adjust your search term, status filter, or distance selection.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        onSearchQueryChange('');
                        onStatusFilterChange('all');
                        setDistanceFilter('all');
                      }}
                      className="mt-3 min-h-11 px-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)]"
                    >
                      Reset filters
                    </button>
                  </div>
                ) : !isDesktop ? (
                  <div id="runner_events_list" className="p-3 space-y-3 bg-[var(--surface-page)]">
                    {filteredRaces.map((race) => {
                      const isSelected = selectedRace?.id === race.id;
                      const isJoined = registeredRaceIds.has(race.id);
                      const dists = sortedRaceDistances(race);
                      const distSummary = dists.map((d) => d.label).join(' · ');
                      return (
                        <article
                          key={race.id}
                          className={`rounded-2xl border bg-[var(--surface-card)] overflow-hidden transition-colors ${
                            isSelected && isSplitPane
                              ? 'border-red-600 ring-2 ring-red-600'
                              : 'border-[var(--border-default)]'
                          }`}
                        >
                          <div className="relative aspect-video w-full bg-[#141416] border-b border-[var(--border-default)] overflow-hidden">
                            {race.posterImage ? (
                              <>
                                <img
                                  src={race.posterImage}
                                  alt={`${race.name} official event poster`}
                                  width={800}
                                  height={450}
                                  loading="lazy"
                                  className="w-full h-full object-contain block"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setLightboxMedia({
                                      title: race.name,
                                      subtitle: race.date,
                                      src: race.posterImage!,
                                      alt: `${race.name} full event poster`,
                                    })
                                  }
                                  aria-label={`View full poster for ${race.name}`}
                                  className="absolute top-2 right-2 min-h-11 px-3 rounded-xl border border-white/20 bg-[#141416]/90 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                                >
                                  <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>Poster</span>
                                </button>
                              </>
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center text-white">
                                <Flag className="w-7 h-7 text-red-400 mb-1.5" aria-hidden="true" />
                                <span className="font-display text-sm font-semibold line-clamp-2">{race.name}</span>
                              </div>
                            )}
                          </div>

                          <div className="p-3.5 space-y-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-lg border text-xs font-semibold leading-tight ${
                                  isJoined
                                    ? 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30'
                                    : 'bg-emerald-100 text-emerald-900 border-emerald-400 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700'
                                }`}
                              >
                                {isJoined ? 'Joined' : 'Reg Open'}
                              </span>
                              <span className="font-mono text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
                                {race.date} · {formatFeeRangePH(dists)}
                              </span>
                            </div>

                            <h3 className="font-display font-semibold text-base text-[var(--text-primary)] leading-snug">
                              {race.name}
                            </h3>

                            {distSummary && (
                              <p className="font-mono text-xs text-[var(--text-secondary)] truncate">
                                {distSummary}
                              </p>
                            )}

                            <div className="pt-1 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedRaceId(race.id);
                                  if (isCompact) setMobileInspecting(true);
                                }}
                                className="min-h-11 flex-1 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] cursor-pointer"
                              >
                                Event details
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedRaceId(race.id);
                                  setShowForm(true);
                                }}
                                className="min-h-11 flex-1 px-3 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <span>{isJoined ? 'Edit entry' : 'Register'}</span>
                                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                    {onScanQr && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={onScanQr}
                          className="min-h-11 w-full px-4 rounded-xl border border-[var(--border-button)] bg-[var(--surface-card)] hover:border-red-600 text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                        >
                          <QrCode className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                          <span>Scan Race / Bib QR</span>
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div id="runner_events_table" className="@container bg-[var(--surface-page)]">
                    <div
                      role="group"
                      aria-label="Sort open events"
                      className="sticky top-0 z-10 px-4 py-2 border-b border-[var(--border-default)] bg-[var(--surface-card)] flex flex-wrap items-center gap-2 text-xs"
                    >
                      <span className="font-semibold text-[var(--text-secondary)] mr-1">Sort by:</span>
                      {(
                        [
                          { key: 'date', label: 'Date' },
                          { key: 'name', label: 'Event name' },
                          { key: 'distances', label: 'Distances' },
                          { key: 'fee', label: 'Entry fee' },
                        ] as const
                      ).map((col) => (
                        <button
                          key={col.key}
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          aria-pressed={sortKey === col.key}
                          className={`min-h-8 px-2.5 rounded-lg border text-xs font-semibold inline-flex items-center cursor-pointer transition-colors ${
                            sortKey === col.key
                              ? 'border-red-600 bg-red-500/10 text-red-700 dark:text-red-400'
                              : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          <span>{col.label}</span>
                          {renderSortMarker(col.key)}
                        </button>
                      ))}
                    </div>

                    <div className="p-4 grid grid-cols-1 @xl:grid-cols-2 gap-4">
                      {filteredRaces.map((race) => {
                        const isSelected = selectedRace?.id === race.id;
                        const isJoined = registeredRaceIds.has(race.id);
                        const dists = sortedRaceDistances(race);
                        const distSummary = dists.map((d) => d.label).join(' · ');

                        return (
                          <article
                            key={race.id}
                            className={`rounded-2xl border bg-[var(--surface-card)] overflow-hidden flex flex-col justify-between transition-colors ${
                              isSelected
                                ? 'border-red-600 ring-2 ring-red-600'
                                : 'border-[var(--border-default)] hover:border-[var(--border-button)]'
                            }`}
                          >
                            <div>
                              <div className="relative aspect-video w-full bg-[#141416] border-b border-[var(--border-default)] overflow-hidden">
                                {race.posterImage ? (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedRaceId(race.id)}
                                    aria-label={`Select ${race.name}`}
                                    className="block w-full h-full cursor-pointer"
                                  >
                                    <img
                                      src={race.posterImage}
                                      alt={`${race.name} official event poster`}
                                      width={800}
                                      height={450}
                                      loading="lazy"
                                      className="w-full h-full object-contain block"
                                    />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedRaceId(race.id)}
                                    aria-label={`Select ${race.name}`}
                                    className="w-full h-full flex flex-col items-center justify-center p-4 text-center text-white cursor-pointer"
                                  >
                                    <Flag className="w-7 h-7 text-red-400 mb-1.5" aria-hidden="true" />
                                    <span className="font-display text-sm font-semibold line-clamp-2">{race.name}</span>
                                  </button>
                                )}
                              </div>

                              <div className="p-4 space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded-lg border text-xs font-semibold leading-tight ${
                                      isJoined
                                        ? 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30'
                                        : 'bg-emerald-100 text-emerald-900 border-emerald-400 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700'
                                    }`}
                                  >
                                    {isJoined ? 'Registered' : 'Reg Open'}
                                  </span>
                                  <span className="font-mono text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
                                    {race.date}
                                  </span>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => setSelectedRaceId(race.id)}
                                  aria-pressed={isSelected}
                                  className="block w-full text-left font-display font-semibold text-base leading-snug text-[var(--text-primary)] hover:text-red-700 dark:hover:text-red-400 cursor-pointer"
                                >
                                  {race.name}
                                </button>

                                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-[var(--text-secondary)]">
                                  <span className="truncate">{distSummary || 'Custom'}</span>
                                  <span className="font-semibold text-[var(--text-primary)] shrink-0">
                                    {formatFeeRangePH(dists)}
                                  </span>
                                </div>

                                <p className="text-xs text-[var(--text-secondary)] truncate">
                                  {(race.inclusions || []).length > 0
                                    ? `Includes: ${race.inclusions.slice(0, 3).join(', ')}`
                                    : `${(race.checkpoints || []).length} checkpoints`}
                                </p>
                              </div>
                            </div>

                            <div className="px-4 pb-4 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setSelectedRaceId(race.id)}
                                className="min-h-9 flex-1 px-3 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] cursor-pointer"
                              >
                                {isSelected ? 'Selected' : 'Inspect'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedRaceId(race.id);
                                  setShowForm(true);
                                }}
                                className={`min-h-9 px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                                  isJoined
                                    ? 'border border-[var(--border-button)] bg-[var(--surface-card)] hover:border-red-600 text-[var(--text-primary)]'
                                    : 'bg-red-700 hover:bg-red-600 text-white'
                                }`}
                              >
                                <span>{isJoined ? 'Update' : 'Register'}</span>
                                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}
            </div>
          </section>

        {/* RIGHT EVENT INSPECTOR DOCK (>= 600px Split Canvas) */}
        {isSplitPane && (
          <aside
            id="runner_event_inspector_dock"
            aria-label="Selected event details and registration"
            className="flex flex-col min-h-0 h-full bg-[var(--surface-card)] overflow-hidden"
          >
            {selectedRace ? (
              <>
                <div className="shrink-0 px-3 sm:px-4 py-2 border-b border-[var(--border-default)] bg-[var(--surface-inset)]/60 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-semibold whitespace-nowrap tabular-nums ${
                          existingForRace
                            ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30'
                            : 'bg-emerald-100 text-emerald-900 border-emerald-400 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700'
                        }`}
                      >
                        {existingForRace ? `Bib #${existingForRace.bibNumber}` : 'Registration Open'}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold tabular-nums whitespace-nowrap text-[var(--text-secondary)]">
                        <Calendar className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                        {selectedRace.date}
                      </span>
                    </div>

                    {filteredRaces.length > 1 && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => stepSelectedRace(-1)}
                          aria-label="Previous open event"
                          className="w-8 h-8 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] flex items-center justify-center text-[var(--text-primary)]"
                        >
                          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                        </button>
                        <span className="px-1 font-mono text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
                          {selectedIndex >= 0 ? selectedIndex + 1 : 1}/{filteredRaces.length}
                        </span>
                        <button
                          type="button"
                          onClick={() => stepSelectedRace(1)}
                          aria-label="Next open event"
                          className="w-8 h-8 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] flex items-center justify-center text-[var(--text-primary)]"
                        >
                          <ChevronRight className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>
                  <h2 className="text-base font-display font-semibold text-[var(--text-primary)] truncate">
                    {selectedRace.name}
                  </h2>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain p-3 sm:p-4 space-y-3">
                  {/* Uncropped 16:9 Poster Preview */}
                  <div
                    aria-label="Uncropped event poster preview"
                    className="relative aspect-video w-full rounded-xl border border-[var(--border-default)] bg-[#141416] overflow-hidden"
                  >
                    {selectedRace.posterImage ? (
                      <>
                        <img
                          src={selectedRace.posterImage}
                          alt={`${selectedRace.name} uncropped event poster`}
                          width={800}
                          height={450}
                          className="w-full h-full object-contain block"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setLightboxMedia({
                              title: selectedRace.name,
                              subtitle: selectedRace.date,
                              src: selectedRace.posterImage!,
                              alt: `${selectedRace.name} full event poster`,
                            })
                          }
                          aria-label={`Inspect full poster for ${selectedRace.name}`}
                          className="absolute top-2 right-2 min-h-11 lg:min-h-0 lg:h-8 px-3 rounded-lg border border-white/20 bg-[#141416]/90 hover:bg-[#141416] text-xs font-semibold text-white inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Full View</span>
                        </button>
                      </>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-center px-3 text-white">
                        <Flag className="w-6 h-6 text-zinc-400 mx-auto mb-1.5" aria-hidden="true" />
                        <p className="text-xs font-semibold text-zinc-300">
                          No promotional poster uploaded yet.
                        </p>
                      </div>
                    )}
                  </div>

                  <RunnerTelemetryStrip
                    ariaLabel="Event quick metrics"
                    className="rounded-xl border border-[var(--border-default)]"
                    items={[
                      { key: 'cats', label: 'Categories', value: String(raceDistances.length || 1) },
                      { key: 'splits', label: 'Splits', value: String((selectedRace.checkpoints || []).length) },
                      { key: 'fee', label: 'Entry Fee', value: formatFeeRangePH(raceDistances), accent: 'red', wide: true },
                    ]}
                  />

                  <OpenEventDetailsSections
                    uid={uid}
                    race={selectedRace}
                    raceDistances={raceDistances}
                    existingForRace={existingForRace}
                    preferredDistance={distanceFilter !== 'all' ? distanceFilter : distance}
                    friendIdentity={friendIdentity}
                    canInvite={can('personal.invites')}
                    onOpenLightbox={setLightboxMedia}
                    compactCourse={false}
                  />
                </div>

                {/* Pinned Dock Footer */}
                <div className="shrink-0 p-3 border-t border-[var(--border-default)] bg-[var(--surface-inset)]/70 grid grid-cols-1 [@media(max-height:480px)]:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setShowForm(true)}
                    disabled={!can('personal.register')}
                    className="min-h-11 w-full px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <span>{existingForRace ? 'Continue to Update Details' : 'Continue to Runner Details'}</span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={onBrowseAllRaces}
                    className="min-h-11 lg:min-h-9 w-full px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center justify-center gap-2 transition-colors"
                  >
                    <Trophy className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                    <span>View All Event Leaderboards</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
                <LayoutGrid className="w-7 h-7 text-[var(--text-secondary)] mb-2" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Event Inspector Ready</h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-xs">
                  Select an open race from the directory to review distances, kit design, route checkpoints, and register.
                </p>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
      )}

      {/* Full-Resolution Poster / Kit Lightbox */}
      {lightboxMedia && (
        <DialogSurface
          variant="sheet"
          dismissOnBackdropClick
          maxWidthCss="56rem"
          titleId="runner_event_media_lightbox"
          onRequestClose={() => setLightboxMedia(null)}
          bodyClassName="p-3 sm:p-4 space-y-3"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2
                  id="runner_event_media_lightbox"
                  className="text-base font-display font-semibold text-[var(--text-primary)] truncate"
                >
                  {lightboxMedia.title}
                </h2>
                <p className="text-xs font-mono tabular-nums text-[var(--text-secondary)]">{lightboxMedia.subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setLightboxMedia(null)}
                aria-label="Close full image view"
                className="min-h-11 min-w-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] flex items-center justify-center text-[var(--text-primary)]"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
            <div className="max-h-[70dvh] w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-2 flex items-center justify-center overflow-hidden">
              <img
                src={lightboxMedia.src}
                alt={lightboxMedia.alt}
                width={1200}
                height={800}
                className="max-w-full max-h-[66dvh] w-auto h-auto object-contain rounded"
              />
            </div>
          </div>
        </DialogSurface>
      )}
    </>
  );
}
