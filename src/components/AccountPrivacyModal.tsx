import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  AlertTriangle,
  Briefcase,
  Calendar,
  Camera,
  CheckCircle2,
  Eye,
  EyeOff,
  Flag,
  Globe,
  HeartPulse,
  ImagePlus,
  KeyRound,
  LogOut,
  Mail,
  MapPin,
  PackageCheck,
  Pencil,
  Phone,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Trophy,
  Upload,
  User,
  Users,
  X,
} from 'lucide-react';
import { auth, changeAccountPassword, db, signOutUser, updateAccountDisplayName } from '../firebase';
import { updateMarketingPreference } from '../lib/accountSecurity';
import { useAndroidBackHandler } from '../lib/capacitorAndroid';
import { resizeImageToDataUrl } from '../lib/image';
import { subscribeSharedRaces } from '../lib/racesStore';
import { computeResults } from '../lib/timing';
import { sanitizeHttpUrl } from '../lib/security';
import { ChipRead, Race, RunnerProfile, UserProfile } from '../types';
import { PasswordResetFlow } from './AccountSecurity';
import DeleteAccountModal from './DeleteAccountModal';
import DialogSurface from './ui/DialogSurface';
import RaceTimeText from './ui/RaceTimeText';
import { Select } from './ui/Select';

interface AccountPrivacyModalProps {
  profile: UserProfile;
  runnerProfiles?: RunnerProfile[];
  onClose: () => void;
}

type ProfileTab = 'overview' | 'about' | 'edit' | 'security';
type AboutCategory = 'overview' | 'work' | 'places' | 'contact' | 'kit';

const MAX_PHOTO_DATA_URL_LENGTH = 95000;
const MAX_COVER_DATA_URL_LENGTH = 140000;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,23}$/;
const STANDARD_SHIRT_SIZES = ['2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'] as const;
const FAVORITE_DISTANCES = ['5K', '10K', '16K', '21K Half Marathon', '42K Full Marathon', 'Ultra Trail'] as const;

interface CoverPresetOption {
  id: string;
  label: string;
  className: string;
}

const COVER_PRESETS: readonly CoverPresetOption[] = [
  {
    id: 'crimson-track',
    label: 'Crimson Track',
    className: 'bg-gradient-to-br from-[#2a0709] via-[#7f1d1d] to-[#dc2626]',
  },
  {
    id: 'midnight-elevation',
    label: 'Midnight Elevation',
    className: 'bg-gradient-to-br from-[#090d16] via-[#1e293b] to-[#475569]',
  },
  {
    id: 'gold-podium',
    label: 'Gold Podium',
    className: 'bg-gradient-to-br from-[#1f1606] via-[#78350f] to-[#d97706]',
  },
  {
    id: 'emerald-trail',
    label: 'Emerald Trail',
    className: 'bg-gradient-to-br from-[#041f18] via-[#065f46] to-[#059669]',
  },
  {
    id: 'carbon-grid',
    label: 'Carbon Grid',
    className: 'bg-gradient-to-br from-[#0b0b0d] via-[#27272a] to-[#52525b]',
  },
];

function roleLabel(role: UserProfile['role']): string {
  switch (role) {
    case 'superadmin':
      return 'Super Admin';
    case 'admin':
      return 'Admin';
    case 'organizer':
      return 'Organizer';
    default:
      return 'Runner';
  }
}

function formatJoinDate(iso?: string): string {
  if (!iso) return 'RacePulsePH member';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso.slice(0, 10);
  return parsed.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

interface ProfileAvatarPickerProps {
  photoPreview: string | null;
  initial: string;
  onPhotoChange: (nextPhoto: string) => void;
  onError: (message: string) => void;
}

/**
 * Shared profile avatar preview, upload, crop/resize, and remove control.
 * Keeps data URLs compact enough for Firestore's 100,000-character profile limit.
 */
export function ProfileAvatarPicker({ photoPreview, initial, onPhotoChange, onError }: ProfileAvatarPickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onError('Please select a valid image file (PNG, JPG, or WebP).');
      return;
    }
    setProcessing(true);
    onError('');
    try {
      let dataUrl = await resizeImageToDataUrl(file, 200, 200, 0.8);
      if (dataUrl.length > MAX_PHOTO_DATA_URL_LENGTH) {
        dataUrl = await resizeImageToDataUrl(file, 160, 160, 0.65);
      }
      if (dataUrl.length > MAX_PHOTO_DATA_URL_LENGTH) {
        onError('Selected image is too detailed after compression. Please pick a simpler image.');
        return;
      }
      onPhotoChange(dataUrl);
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed to process the selected image.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="flex flex-col sm:flex-row items-center gap-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4">
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={processing}
        aria-label="Upload profile photo"
        title="Upload profile photo"
        className="relative w-20 h-20 rounded-full overflow-hidden bg-red-700 text-white border border-red-800 dark:border-red-400/40 flex items-center justify-center font-semibold text-2xl shrink-0 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
      >
        {photoPreview ? (
          <img src={photoPreview} alt="" aria-hidden="true" className="w-full h-full object-cover" />
        ) : (
          <span aria-hidden="true">{initial}</span>
        )}
        <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition flex items-center justify-center">
          <Camera className="w-5 h-5 text-white" aria-hidden="true" />
        </span>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        aria-label="Select profile photo file"
        onChange={(event) => void handleFileChange(event)}
        className="hidden"
      />

      <div className="flex-1 min-w-0 text-center sm:text-left space-y-2">
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">Profile Picture</p>
          <p className="text-xs text-[var(--text-secondary)]">Square PNG, JPG, or WebP. Automatically cropped to 200x200.</p>
        </div>
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={processing}
            className="min-h-11 px-3 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-2 transition-colors disabled:opacity-60"
          >
            {processing ? (
              <RefreshCw className="w-3.5 h-3.5 motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
            )}
            <span>{photoPreview ? 'Change Photo' : 'Upload Photo'}</span>
          </button>
          {photoPreview && (
            <button
              type="button"
              onClick={() => {
                onError('');
                onPhotoChange('');
              }}
              disabled={processing}
              className="min-h-11 px-3 py-2 rounded-xl border border-red-700/35 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-700 hover:text-white inline-flex items-center gap-2 transition-colors disabled:opacity-60"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Remove Photo</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface PasswordSecuritySectionProps {
  onResetViaEmail: () => void;
}

/**
 * Shared direct password change and email verification reset controls.
 */
export function PasswordSecuritySection({ onResetViaEmail }: PasswordSecuritySectionProps) {
  const sectionId = useId();
  const [showForm, setShowForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');

    if (!currentPassword) {
      setError('Please enter your current password.');
      return;
    }
    if (newPassword.length < 6 || newPassword.length > 128) {
      setError('New password must be between 6 and 128 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('Choose a new password that differs from your current password.');
      return;
    }

    setBusy(true);
    try {
      await changeAccountPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowForm(false);
      setNotice('Password updated. Your new password takes effect immediately.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update your password right now.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <KeyRound className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
            <span>Password &amp; Security</span>
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            Update your password directly or use an email verification code if you forgot it.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setShowForm((prev) => !prev);
              setError('');
              setNotice('');
            }}
            aria-expanded={showForm}
            className="min-h-11 px-3 py-2 rounded-xl bg-red-700 text-white hover:bg-red-600 text-xs font-semibold transition-colors"
          >
            {showForm ? 'Hide Form' : 'Change Password'}
          </button>
          <button
            type="button"
            onClick={onResetViaEmail}
            className="min-h-11 px-3 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] transition-colors"
          >
            Reset via Email Code
          </button>
        </div>
      </div>

      {notice && (
        <p role="status" className="flex items-center gap-2 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{notice}</span>
        </p>
      )}

      {showForm && (
        <form onSubmit={(event) => void handleSubmit(event)} className="pt-3 border-t border-[var(--border-subtle)] space-y-3" aria-busy={busy}>
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label htmlFor={`${sectionId}-current`} className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Current Password
              </label>
              <button
                type="button"
                onClick={() => setShowPasswords((prev) => !prev)}
                aria-pressed={showPasswords}
                className="min-h-11 px-2 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1"
              >
                {showPasswords ? <EyeOff className="w-3.5 h-3.5" aria-hidden="true" /> : <Eye className="w-3.5 h-3.5" aria-hidden="true" />}
                <span>{showPasswords ? 'Hide' : 'Show'}</span>
              </button>
            </div>
            <input
              id={`${sectionId}-current`}
              type={showPasswords ? 'text' : 'password'}
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              disabled={busy}
              placeholder="Enter current password"
              className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${sectionId}-new`} className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                New Password
              </label>
              <input
                id={`${sectionId}-new`}
                type={showPasswords ? 'text' : 'password'}
                autoComplete="new-password"
                minLength={6}
                maxLength={128}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                disabled={busy}
                placeholder="At least 6 characters"
                className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
              />
            </div>

            <div>
              <label htmlFor={`${sectionId}-confirm`} className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                Confirm New Password
              </label>
              <input
                id={`${sectionId}-confirm`}
                type={showPasswords ? 'text' : 'password'}
                autoComplete="new-password"
                minLength={6}
                maxLength={128}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={busy}
                placeholder="Repeat new password"
                className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="text-xs font-semibold text-red-700 dark:text-red-400 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setError('');
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
              }}
              disabled={busy}
              className="min-h-11 px-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="min-h-11 px-4 rounded-xl bg-gradient-to-r from-red-700 to-red-800 hover:from-red-600 hover:to-red-700 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-60"
            >
              {busy ? <RefreshCw className="w-3.5 h-3.5 motion-safe:animate-spin" aria-hidden="true" /> : <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />}
              <span>{busy ? 'Updating...' : 'Update Password'}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * Facebook-inspired Profile Management workspace shared across Operations
 * (Super Admin, Admin, Organizer) and Personal (Runner) portals.
 */
export default function AccountPrivacyModal({ profile, runnerProfiles: providedRunnerProfiles, onClose }: AccountPrivacyModalProps) {
  const dialogId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const headerAvatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const profileTabsRef = useRef<HTMLElement>(null);
  const tabButtonRefs = useRef<Partial<Record<ProfileTab, HTMLButtonElement | null>>>({});
  const tabEpochRef = useRef(0);

  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');
  const [aboutCategory, setAboutCategory] = useState<AboutCategory>('overview');
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [editingBioInline, setEditingBioInline] = useState(false);

  const updateTabFades = useCallback(() => {
    const nav = profileTabsRef.current;
    if (!nav) return;
    const maxScroll = Math.max(0, nav.scrollWidth - nav.clientWidth);
    const hasLeft = nav.scrollLeft > 4;
    const hasRight = nav.scrollLeft < maxScroll - 4;
    nav.style.setProperty('--rp-tab-fade-start', hasLeft ? '20px' : '0px');
    nav.style.setProperty('--rp-tab-fade-end', hasRight ? '24px' : '0px');
  }, []);

  useEffect(() => {
    const nav = profileTabsRef.current;
    if (!nav) return;
    updateTabFades();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateTabFades) : null;
    ro?.observe(nav);
    window.addEventListener('resize', updateTabFades);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updateTabFades);
    };
  }, [updateTabFades]);

  useEffect(() => {
    const btn = tabButtonRefs.current[activeTab];
    if (btn && typeof btn.scrollIntoView === 'function') {
      const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      btn.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest', inline: 'nearest' });
    }
    const timer = window.setTimeout(updateTabFades, 180);
    return () => window.clearTimeout(timer);
  }, [activeTab, updateTabFades]);

  const switchTab = (nextTab: ProfileTab) => {
    tabEpochRef.current += 1;
    setErrorMessage('');
    setStatusMessage('');
    setActiveTab(nextTab);
  };

  // Editable profile fields
  const [displayName, setDisplayName] = useState(profile.displayName || '');
  const [nickname, setNickname] = useState(profile.nickname || '');
  const [username, setUsername] = useState(profile.username || '');
  const [photoPreview, setPhotoPreview] = useState(profile.photoURL || '');
  const [coverPreview, setCoverPreview] = useState(profile.coverURL || '');
  const [coverPreset, setCoverPreset] = useState(profile.coverPreset || 'crimson-track');
  const [bio, setBio] = useState(profile.bio || '');
  const [location, setLocation] = useState(profile.location || '');
  const [runClub, setRunClub] = useState(profile.runClub || '');
  const [favoriteDistance, setFavoriteDistance] = useState(profile.favoriteDistance || '');
  const [socialLink, setSocialLink] = useState(profile.socialLink || '');
  const [shirtSize, setShirtSize] = useState(profile.shirtSize || '');
  const [shirtCustomMode, setShirtCustomMode] = useState(() =>
    Boolean(profile.shirtSize && !STANDARD_SHIRT_SIZES.includes(profile.shirtSize as (typeof STANDARD_SHIRT_SIZES)[number])),
  );
  const [emergencyContactName, setEmergencyContactName] = useState(profile.emergencyContactName || '');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState(profile.emergencyContactPhone || '');
  const [medicalNotes, setMedicalNotes] = useState(profile.medicalNotes || '');
  const [marketingOptIn, setMarketingOptIn] = useState(Boolean(profile.marketingOptIn));

  const [saving, setSaving] = useState(false);
  const [processingMedia, setProcessingMedia] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [resettingPassword, setResettingPassword] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Authentic activity data from RacePulsePH
  const [races, setRaces] = useState<Race[]>([]);
  const [fetchedRunnerProfiles, setFetchedRunnerProfiles] = useState<RunnerProfile[]>([]);
  const [recentResult, setRecentResult] = useState<ReturnType<typeof computeResults>[number] | null>(null);

  useAndroidBackHandler(resettingPassword, () => setResettingPassword(false));

  useEffect(() => {
    return subscribeSharedRaces((rawList, loaded) => {
      if (!loaded) return;
      const sorted = [...rawList].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setRaces(sorted);
    });
  }, []);

  useEffect(() => {
    if (providedRunnerProfiles !== undefined || !profile.uid) return;
    let active = true;
    getDocs(query(collection(db, 'runners'), where('uid', '==', profile.uid)))
      .then((snap) => {
        if (!active) return;
        const list: RunnerProfile[] = [];
        snap.forEach((docSnap) => list.push(docSnap.data() as RunnerProfile));
        setFetchedRunnerProfiles(list);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [providedRunnerProfiles, profile.uid]);

  const myRunnerProfiles = providedRunnerProfiles ?? fetchedRunnerProfiles;
  const raceById = useMemo(() => new Map(races.map((r) => [r.id, r])), [races]);

  const mostRecentCompletedEntry = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    return [...myRunnerProfiles]
      .filter((rp) => {
        const race = raceById.get(rp.raceId);
        return Boolean(race && (race.completedAt || race.date < todayStr));
      })
      .sort((a, b) => (raceById.get(b.raceId)?.date || '').localeCompare(raceById.get(a.raceId)?.date || ''))[0];
  }, [myRunnerProfiles, raceById]);

  useEffect(() => {
    const race = mostRecentCompletedEntry ? raceById.get(mostRecentCompletedEntry.raceId) : undefined;
    if (!mostRecentCompletedEntry || !race) {
      setRecentResult(null);
      return;
    }
    let active = true;
    getDocs(
      query(
        collection(db, 'chipReads'),
        where('raceId', '==', race.id),
        where('bibNumber', '==', mostRecentCompletedEntry.bibNumber),
      ),
    )
      .then((snapshot) => {
        if (!active) return;
        const chipReads: ChipRead[] = [];
        snapshot.forEach((docSnap) => chipReads.push(docSnap.data() as ChipRead));
        const matched = computeResults(race.checkpoints, chipReads, [mostRecentCompletedEntry]).find(
          (item) => item.bibNumber === mostRecentCompletedEntry.bibNumber,
        );
        setRecentResult(matched || null);
      })
      .catch(() => {
        if (active) setRecentResult(null);
      });
    return () => {
      active = false;
    };
  }, [mostRecentCompletedEntry?.raceId, mostRecentCompletedEntry?.bibNumber, raceById]);

  const activeCoverClass = useMemo(
    () => (COVER_PRESETS.find((preset) => preset.id === coverPreset) ?? COVER_PRESETS[0]).className,
    [coverPreset],
  );

  const handleHeaderAvatarFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Please select a valid image file (PNG, JPG, or WebP).');
      return;
    }
    setProcessingMedia(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      let dataUrl = await resizeImageToDataUrl(file, 200, 200, 0.8);
      if (dataUrl.length > MAX_PHOTO_DATA_URL_LENGTH) {
        dataUrl = await resizeImageToDataUrl(file, 160, 160, 0.65);
      }
      if (dataUrl.length > MAX_PHOTO_DATA_URL_LENGTH) {
        setErrorMessage('Selected image is too large after compression. Please pick a simpler photo.');
        return;
      }
      setPhotoPreview(dataUrl);
      await saveProfileFields({ photoURL: dataUrl }, 'Profile photo updated.');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to upload profile photo.');
    } finally {
      setProcessingMedia(false);
    }
  };

  const handleCoverFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Please select a valid image file (PNG, JPG, or WebP).');
      return;
    }
    setProcessingMedia(true);
    setErrorMessage('');
    setStatusMessage('');
    try {
      let dataUrl = await resizeImageToDataUrl(file, 720, 240, 0.78);
      if (dataUrl.length > MAX_COVER_DATA_URL_LENGTH) {
        dataUrl = await resizeImageToDataUrl(file, 600, 200, 0.65);
      }
      if (dataUrl.length > MAX_COVER_DATA_URL_LENGTH) {
        setErrorMessage('Cover image is too detailed after compression. Try a cleaner photo.');
        return;
      }
      setCoverPreview(dataUrl);
      setShowCoverPicker(false);
      if (activeTab !== 'edit') {
        await saveProfileFields({ coverURL: dataUrl }, 'Cover photo updated.');
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to upload cover photo.');
    } finally {
      setProcessingMedia(false);
    }
  };

  const syncFriendProfileCard = async (nextName: string, nextNickname: string, nextPhoto: string) => {
    if (!profile.username) return;
    try {
      const friendBatch = writeBatch(db);
      const usernameRef = doc(db, 'usernameIndex', profile.username);
      const usernameSnap = await getDoc(usernameRef).catch(() => null);
      if (usernameSnap && !usernameSnap.exists() && auth.currentUser?.emailVerified) {
        friendBatch.set(usernameRef, {
          username: profile.username,
          uid: profile.uid,
          email: auth.currentUser.email || profile.email,
          createdAt: profile.createdAt || new Date().toISOString(),
        });
      }
      const friendPayload: {
        uid: string;
        username: string;
        displayName: string;
        nickname: string;
        photoURL?: string;
        updatedAt: string;
      } = {
        uid: profile.uid,
        username: profile.username,
        displayName: nextName.trim() || profile.displayName,
        nickname: nextNickname.trim().slice(0, 30),
        updatedAt: new Date().toISOString(),
      };
      if (nextPhoto.length <= 100000) {
        friendPayload.photoURL = nextPhoto;
      }
      friendBatch.set(doc(db, 'friendDirectory', profile.username), friendPayload, { merge: true });
      friendBatch.set(doc(db, 'friendProfiles', profile.uid), friendPayload, { merge: true });
      await friendBatch.commit();
    } catch (syncErr) {
      console.warn('Secondary friend directory card sync skipped:', syncErr);
    }
  };

  const saveProfileFields = async (partial: Partial<UserProfile>, successNotice: string) => {
    const requestEpoch = tabEpochRef.current;
    setErrorMessage('');
    setStatusMessage('');
    setSaving(true);
    try {
      const safeDisplayName = (partial.displayName ?? displayName.trim()) || profile.displayName || 'RacePulse Athlete';
      await updateDoc(doc(db, 'users', profile.uid), {
        ...partial,
        displayName: safeDisplayName,
      });
      if (partial.displayName !== undefined || partial.nickname !== undefined || partial.photoURL !== undefined) {
        await syncFriendProfileCard(
          partial.displayName ?? displayName,
          partial.nickname ?? nickname,
          partial.photoURL ?? photoPreview,
        );
      }
      if (tabEpochRef.current === requestEpoch) {
        setStatusMessage(successNotice);
      }
    } catch (err: unknown) {
      if (tabEpochRef.current === requestEpoch) {
        setErrorMessage(err instanceof Error ? err.message : 'Could not save profile update.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAllProfile = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const trimmedName = displayName.trim();
    const trimmedNickname = nickname.trim();
    const nextUsername = username.trim().toLowerCase();
    const trimmedBio = bio.trim();
    const trimmedLocation = location.trim();
    const trimmedRunClub = runClub.trim();
    const trimmedDistance = favoriteDistance.trim();
    const trimmedSocial = socialLink.trim();
    const trimmedShirt = shirtSize.trim();
    const trimmedEmergencyName = emergencyContactName.trim();
    const trimmedEmergencyPhone = emergencyContactPhone.trim();
    const trimmedMedical = medicalNotes.trim();

    setErrorMessage('');
    setStatusMessage('');

    if (!trimmedName || trimmedName.length > 100) {
      setErrorMessage('Full name must be between 1 and 100 characters.');
      return;
    }
    if (trimmedNickname.length > 30) {
      setErrorMessage('Nickname must be 30 characters or fewer.');
      return;
    }
    if (nextUsername && !USERNAME_PATTERN.test(nextUsername)) {
      setErrorMessage('Username must be 3 to 24 characters: lowercase letters, numbers, dot, underscore, or hyphen.');
      return;
    }
    if (profile.username && nextUsername !== profile.username) {
      setErrorMessage('Your @username is permanent once set.');
      return;
    }
    if (trimmedBio.length > 160) {
      setErrorMessage('Bio must be 160 characters or fewer.');
      return;
    }
    if (trimmedLocation.length > 80 || trimmedRunClub.length > 80) {
      setErrorMessage('Location and Run Club must each be 80 characters or fewer.');
      return;
    }
    const safeSocial = trimmedSocial ? sanitizeHttpUrl(trimmedSocial) : '';
    if (trimmedSocial && !safeSocial) {
      setErrorMessage('Social or athlete profile link must start with https:// or http://.');
      return;
    }

    setSaving(true);
    try {
      await updateAccountDisplayName(trimmedName).catch(() => undefined);
      const profileUpdate = {
        displayName: trimmedName,
        nickname: trimmedNickname,
        photoURL: photoPreview,
        coverURL: coverPreview,
        coverPreset,
        bio: trimmedBio,
        location: trimmedLocation,
        runClub: trimmedRunClub,
        favoriteDistance: trimmedDistance,
        socialLink: safeSocial,
        shirtSize: trimmedShirt,
        emergencyContactName: trimmedEmergencyName,
        emergencyContactPhone: trimmedEmergencyPhone,
        medicalNotes: trimmedMedical,
        marketingOptIn,
        marketingUpdatedAt: new Date().toISOString(),
      };

      if (!profile.username && nextUsername) {
        await runTransaction(db, async (transaction) => {
          const usernameRef = doc(db, 'usernameIndex', nextUsername);
          const usernameSnap = await transaction.get(usernameRef);
          if (usernameSnap.exists()) {
            throw new Error('That @username is already taken. Please choose another one.');
          }
          transaction.update(doc(db, 'users', profile.uid), { ...profileUpdate, username: nextUsername });
          transaction.set(usernameRef, {
            username: nextUsername,
            uid: profile.uid,
            email: auth.currentUser?.email || profile.email,
            createdAt: new Date().toISOString(),
          });
          const friendPayload: {
            uid: string;
            username: string;
            displayName: string;
            nickname: string;
            photoURL?: string;
            updatedAt: string;
          } = {
            uid: profile.uid,
            username: nextUsername,
            displayName: trimmedName,
            nickname: trimmedNickname,
            updatedAt: new Date().toISOString(),
          };
          if (photoPreview.length <= 100000) {
            friendPayload.photoURL = photoPreview;
          }
          transaction.set(doc(db, 'friendDirectory', nextUsername), friendPayload);
          transaction.set(doc(db, 'friendProfiles', profile.uid), friendPayload);
        });
      } else {
        await updateDoc(doc(db, 'users', profile.uid), profileUpdate);
        await syncFriendProfileCard(trimmedName, trimmedNickname, photoPreview);
      }

      if (marketingOptIn !== Boolean(profile.marketingOptIn)) {
        await updateMarketingPreference(marketingOptIn).catch(() => undefined);
      }
      setStatusMessage('Profile changes saved.');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save your profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleMarketing = async (checked: boolean) => {
    setMarketingOptIn(checked);
    setErrorMessage('');
    setStatusMessage('');
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        marketingOptIn: checked,
        marketingUpdatedAt: new Date().toISOString(),
      }).catch(() => undefined);
      await updateMarketingPreference(checked).catch(() => undefined);
      setStatusMessage(
        checked
          ? 'Optional event updates and announcements enabled.'
          : 'Opted out of optional event announcements.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (showDeleteConfirm) {
    return (
      <DeleteAccountModal
        profile={profile}
        onClose={() => {
          setShowDeleteConfirm(false);
        }}
      />
    );
  }

  if (resettingPassword) {
    return (
      <DialogSurface
        titleId={`${dialogId}-reset-title`}
        onRequestClose={() => setResettingPassword(false)}
        className="w-full max-w-md bg-transparent border-0 p-0 shadow-none"
      >
        <h2 id={`${dialogId}-reset-title`} className="sr-only">Reset account password</h2>
        <PasswordResetFlow
          initialEmail={profile.email}
          backLabel="Back to profile settings"
          onBack={() => setResettingPassword(false)}
          onDone={() => void signOutUser()}
        />
      </DialogSurface>
    );
  }

  const effectiveName = displayName.trim() || profile.displayName || 'RacePulse Athlete';
  const effectiveNickname = nickname.trim();
  const effectiveUsername = (profile.username || username.trim()).toLowerCase();
  const avatarInitial = (effectiveNickname || effectiveName).charAt(0).toUpperCase();
  const workspaceEvents = races.filter((race) => race.createdBy === profile.uid);
  const displayedEvents = workspaceEvents.length > 0 ? workspaceEvents : races;
  const usesCustomShirt = shirtCustomMode || Boolean(shirtSize && !STANDARD_SHIRT_SIZES.includes(shirtSize as (typeof STANDARD_SHIRT_SIZES)[number]));

  return (
    <DialogSurface
      variant="sheet"
      dismissOnBackdropClick
      titleId={`${dialogId}-title`}
      descriptionId={`${dialogId}-desc`}
      onRequestClose={onClose}
      initialFocusRef={closeRef}
      className="sm:inset-0 sm:m-auto h-fit w-full sm:w-[calc(100%-2rem)] max-w-4xl max-h-[92dvh] overflow-y-auto rounded-t-[20px] sm:rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] p-0 relative"
    >
      {/* Hidden quick inputs for header avatar & cover banner */}
      <input
        ref={headerAvatarInputRef}
        type="file"
        accept="image/*"
        aria-label="Upload header profile photo"
        onChange={(event) => void handleHeaderAvatarFile(event)}
        className="hidden"
      />
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        aria-label="Upload profile cover photo"
        onChange={(event) => void handleCoverFileChange(event)}
        className="hidden"
      />

      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close profile and account settings"
        className="absolute top-3 right-3 z-20 min-h-11 min-w-11 rounded-full bg-[var(--surface-inset)] sm:bg-black/55 hover:bg-[var(--surface-hover)] sm:hover:bg-black/75 border border-[var(--border-default)] sm:border-white/25 text-[var(--text-primary)] sm:text-white flex items-center justify-center transition-colors sm:backdrop-blur-sm"
      >
        <X className="w-5 h-5" aria-hidden="true" />
      </button>

      {/* Cover banner (tablet/desktop >= 640px only; hidden on compact mobile sheet so content leads) */}
      <div className={`hidden sm:block relative h-48 w-full overflow-hidden rounded-t-2xl ${coverPreview ? 'bg-black' : activeCoverClass}`}>
        {coverPreview ? (
          <img src={coverPreview} alt="" aria-hidden="true" className="w-full h-full object-cover" />
        ) : (
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-25"
            style={{
              backgroundImage:
                'radial-gradient(circle at 20% 25%, rgba(255,255,255,0.28) 0%, transparent 45%), repeating-linear-gradient(135deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 1px, transparent 1px, transparent 14px)',
            }}
          />
        )}
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/65" />

        <button
          type="button"
          onClick={() => setShowCoverPicker((prev) => !prev)}
          aria-expanded={showCoverPicker}
          className="absolute bottom-3 right-3 z-10 min-h-11 px-3 py-2 rounded-xl bg-black/65 hover:bg-black/85 border border-white/25 text-white text-xs font-semibold inline-flex items-center gap-2 backdrop-blur-sm transition-colors"
        >
          <ImagePlus className="w-4 h-4" aria-hidden="true" />
          <span>Edit cover photo</span>
        </button>
      </div>

      {/* Expandable Cover Photo Customizer */}
      {showCoverPicker && (
        <div className="px-4 sm:px-6 py-3 border-b border-[var(--border-subtle)] bg-[var(--surface-inset)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-[var(--text-secondary)] mr-1">Cover theme:</span>
            {COVER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  setCoverPreset(preset.id);
                  setCoverPreview('');
                  void saveProfileFields({ coverPreset: preset.id, coverURL: '' }, `Cover updated to ${preset.label}.`);
                }}
                aria-label={`Use ${preset.label} cover`}
                aria-pressed={!coverPreview && coverPreset === preset.id}
                title={preset.label}
                className={`min-h-11 px-3 py-2 rounded-xl border text-xs font-semibold inline-flex items-center gap-2 transition-colors ${
                  !coverPreview && coverPreset === preset.id
                    ? 'border-red-600 dark:border-red-400 bg-[var(--surface-card)] text-[var(--text-primary)]'
                    : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span className={`w-4 h-4 rounded-full ${preset.className} border border-white/25 shrink-0`} aria-hidden="true" />
                <span className="hidden sm:inline">{preset.label}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              disabled={processingMedia}
              className="min-h-11 px-3 py-2 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-60"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Upload Cover Photo</span>
            </button>
            {coverPreview && (
              <button
                type="button"
                onClick={() => {
                  setCoverPreview('');
                  void saveProfileFields({ coverURL: '' }, 'Custom cover photo removed.');
                }}
                disabled={processingMedia}
                className="min-h-11 px-3 py-2 rounded-xl border border-red-700/35 text-red-700 dark:text-red-300 hover:bg-red-700 hover:text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Remove Cover</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Avatar & Identity Header */}
      <div className="px-3 sm:px-6 pb-3 sm:pb-4 border-b border-[var(--border-subtle)]">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-4 pr-12 sm:pr-0">
          <div className="flex items-center sm:items-end gap-3 sm:gap-4 min-w-0">
            <div className={`relative ${showCoverPicker ? 'mt-3' : 'mt-3 sm:-mt-16'} w-16 h-16 sm:w-28 sm:h-28 shrink-0 self-start transition-[margin] duration-150`}>
              <div className="w-full h-full rounded-full overflow-hidden bg-red-700 text-white ring-4 ring-[var(--surface-card)] flex items-center justify-center font-display font-semibold text-2xl sm:text-4xl">
                {photoPreview ? (
                  <img src={photoPreview} alt="" aria-hidden="true" className="w-full h-full object-cover" />
                ) : (
                  <span aria-hidden="true">{avatarInitial}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => headerAvatarInputRef.current?.click()}
                disabled={processingMedia}
                aria-label="Change profile picture"
                title="Change profile picture"
                className="absolute -bottom-1 -right-1 min-h-11 min-w-11 rounded-full bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] border border-[var(--border-default)] text-[var(--text-primary)] flex items-center justify-center transition-colors"
              >
                <Camera className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="min-w-0 space-y-0.5 sm:space-y-1 pt-2 sm:pt-0 sm:pb-1">
              <h2 id={`${dialogId}-title`} className="font-display text-lg sm:text-2xl font-semibold text-[var(--text-primary)] break-words">
                {effectiveName}
                {effectiveNickname && (
                  <span className="font-normal text-[var(--text-secondary)]"> ({effectiveNickname})</span>
                )}
              </h2>
              <p id={`${dialogId}-desc`} className="text-xs sm:text-sm text-[var(--text-secondary)] break-words">
                {effectiveUsername ? `@${effectiveUsername}` : profile.email} &bull; {roleLabel(profile.role)}
                {runClub.trim() ? ` • ${runClub.trim()}` : ''}
              </p>
              {bio.trim() && (
                <p className="text-xs text-[var(--text-primary)] leading-relaxed pt-0.5">{bio.trim()}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0 sm:pb-1">
            <button
              type="button"
              onClick={() => switchTab('edit')}
              className="min-h-11 px-3.5 py-2 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Edit profile</span>
            </button>
            <button
              type="button"
              onClick={() => switchTab('security')}
              className="min-h-11 px-3.5 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 transition-colors"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
              <span>Security</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                void signOutUser();
              }}
              className="min-h-11 px-3.5 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:border-red-600/40 text-xs font-semibold text-red-700 dark:text-red-400 inline-flex items-center gap-1.5 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </div>
        </div>

        {/* Single-Row Scrollable Profile Tabs */}
        <nav
          ref={profileTabsRef}
          onScroll={updateTabFades}
          aria-label="Profile sections"
          role="tablist"
          className="rp-tablist-scroll mt-4 -mb-4 items-center gap-1"
        >
          {(
            [
              { id: 'overview', label: 'Overview' },
              { id: 'about', label: 'About' },
              { id: 'edit', label: 'Edit Profile' },
              { id: 'security', label: 'Settings & Security' },
            ] as const
          ).map((item) => {
            const isSelected = activeTab === item.id;
            return (
              <button
                key={item.id}
                ref={(el) => { tabButtonRefs.current[item.id] = el; }}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => switchTab(item.id)}
                className={`min-h-11 px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  isSelected
                    ? 'border-red-700 dark:border-red-400 text-red-700 dark:text-red-400'
                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-inset)] rounded-t-xl'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Inline Global Feedback Bar */}
      {(errorMessage || statusMessage) && (
        <div className="px-4 sm:px-6 pt-4 space-y-2">
          {errorMessage && (
            <p role="alert" className="rounded-xl border border-red-700/30 bg-red-50 dark:bg-red-950/35 px-4 py-3 text-xs font-semibold text-red-700 dark:text-red-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{errorMessage}</span>
            </p>
          )}
          {statusMessage && (
            <p role="status" className="rounded-xl border border-emerald-700/30 bg-emerald-50 dark:bg-emerald-950/35 px-4 py-3 text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{statusMessage}</span>
            </p>
          )}
        </div>
      )}

      {/* ========== TAB BODY ========== */}
      <div className="p-4 sm:p-6">
        {/* TAB 1: OVERVIEW (FACEBOOK 2-COLUMN INTRO + ACTIVITY) */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* Left Intro Card */}
            <section aria-label="Intro" className="lg:col-span-5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-4">
              <h3 className="font-display text-base font-semibold text-[var(--text-primary)]">Intro</h3>

              {/* Bio block with inline edit */}
              <div className="space-y-2 border-b border-[var(--border-subtle)] pb-4">
                {editingBioInline ? (
                  <div className="space-y-2">
                    <label htmlFor={`${dialogId}-inline-bio`} className="sr-only">Profile bio</label>
                    <textarea
                      id={`${dialogId}-inline-bio`}
                      rows={3}
                      maxLength={160}
                      value={bio}
                      onChange={(event) => setBio(event.target.value)}
                      placeholder="Describe your running goals, role, or favorite races..."
                      className="w-full resize-y rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-xs sm:text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[var(--text-secondary)]">{bio.length}/160</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setBio(profile.bio || '');
                            setEditingBioInline(false);
                          }}
                          className="min-h-11 px-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-secondary)]"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => {
                            void saveProfileFields({ bio: bio.trim() }, 'Bio updated.').then(() => {
                              setEditingBioInline(false);
                            });
                          }}
                          className="min-h-11 px-3 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold disabled:opacity-60"
                        >
                          {saving ? 'Saving...' : 'Save bio'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-xs sm:text-sm text-center text-[var(--text-primary)] leading-relaxed">
                      {bio.trim() || 'No bio added yet.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => setEditingBioInline(true)}
                      className="min-h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] transition-colors"
                    >
                      {bio.trim() ? 'Edit bio' : 'Add bio'}
                    </button>
                  </>
                )}
              </div>

              {/* Iconic Intro Rows */}
              <ul className="space-y-3 text-xs sm:text-sm">
                <li className="flex items-start gap-3">
                  <Briefcase className="w-4 h-4 text-[var(--text-secondary)] shrink-0 mt-0.5" aria-hidden="true" />
                  <span className="text-[var(--text-primary)]">
                    <span className="font-semibold">{roleLabel(profile.role)}</span> at RacePulsePH
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Users className="w-4 h-4 text-[var(--text-secondary)] shrink-0 mt-0.5" aria-hidden="true" />
                  <span className={runClub.trim() ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}>
                    {runClub.trim() ? (
                      <>
                        Runs with <span className="font-semibold">{runClub.trim()}</span>
                      </>
                    ) : (
                      'Add a run club or team'
                    )}
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-[var(--text-secondary)] shrink-0 mt-0.5" aria-hidden="true" />
                  <span className={location.trim() ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}>
                    {location.trim() ? (
                      <>
                        Lives in <span className="font-semibold">{location.trim()}</span>
                      </>
                    ) : (
                      'Add your home city'
                    )}
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <Trophy className="w-4 h-4 text-[var(--text-secondary)] shrink-0 mt-0.5" aria-hidden="true" />
                  <span className={favoriteDistance.trim() ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}>
                    {favoriteDistance.trim() ? (
                      <>
                        Favorite distance: <span className="font-semibold">{favoriteDistance.trim()}</span>
                      </>
                    ) : (
                      'Add your favorite race distance'
                    )}
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <PackageCheck className="w-4 h-4 text-[var(--text-secondary)] shrink-0 mt-0.5" aria-hidden="true" />
                  <span className={shirtSize.trim() ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}>
                    {shirtSize.trim() ? (
                      <>
                        Race kit size: <span className="font-semibold">{shirtSize.trim()}</span>
                      </>
                    ) : (
                      'Add race shirt size'
                    )}
                  </span>
                </li>
                {socialLink.trim() && (
                  <li className="flex items-start gap-3">
                    <Globe className="w-4 h-4 text-[var(--text-secondary)] shrink-0 mt-0.5" aria-hidden="true" />
                    <span className="text-red-700 dark:text-red-400 font-semibold break-all">{socialLink.trim()}</span>
                  </li>
                )}
                <li className="flex items-start gap-3">
                  <Calendar className="w-4 h-4 text-[var(--text-secondary)] shrink-0 mt-0.5" aria-hidden="true" />
                  <span className="text-[var(--text-secondary)]">Joined {formatJoinDate(profile.createdAt)}</span>
                </li>
              </ul>

              <button
                type="button"
                onClick={() => switchTab('edit')}
                className="min-h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] transition-colors"
              >
                Edit details
              </button>
            </section>

            {/* Right Activity & Friend Preview Column */}
            <div className="lg:col-span-7 space-y-4">
              {/* Public / Friend Card Preview */}
              <section aria-label="Friend card preview" className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-semibold text-[var(--text-primary)]">Friend Directory Card</h3>
                  <button
                    type="button"
                    onClick={() => switchTab('edit')}
                    className="min-h-11 px-3 rounded-xl text-xs font-semibold text-red-700 dark:text-red-400 hover:bg-[var(--surface-card)] transition-colors"
                  >
                    Edit card
                  </button>
                </div>
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3 flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full overflow-hidden bg-red-700 text-white flex items-center justify-center font-semibold text-lg shrink-0">
                    {photoPreview ? (
                      <img src={photoPreview} alt="" aria-hidden="true" className="w-full h-full object-cover" />
                    ) : (
                      <span aria-hidden="true">{avatarInitial}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                      {effectiveName}
                      {effectiveNickname ? ` (${effectiveNickname})` : ''}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] truncate">
                      {effectiveUsername ? `@${effectiveUsername}` : 'Set an @username in Edit Profile to connect with friends'}
                    </p>
                  </div>
                </div>
              </section>

              {/* Most Recent Race & Activity */}
              <section aria-label="RacePulsePH activity" className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                    <Flag className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                    <span>{myRunnerProfiles.length > 0 ? 'My Race Activity' : 'Workspace Events'}</span>
                  </h3>
                  <span className="text-xs text-[var(--text-secondary)]">
                    {myRunnerProfiles.length > 0
                      ? `${myRunnerProfiles.length} ${myRunnerProfiles.length === 1 ? 'race' : 'races'}`
                      : `${displayedEvents.length} ${displayedEvents.length === 1 ? 'event' : 'events'}`}
                  </span>
                </div>

                {recentResult && mostRecentCompletedEntry && raceById.get(mostRecentCompletedEntry.raceId) && (
                  <div className="rounded-xl border border-red-700/25 bg-[var(--surface-card)] p-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wider">Latest Result</p>
                      <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {raceById.get(mostRecentCompletedEntry.raceId)?.name}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {raceById.get(mostRecentCompletedEntry.raceId)?.date} &bull; {mostRecentCompletedEntry.distance} &bull; #{mostRecentCompletedEntry.bibNumber}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div>
                        <span className="block text-xs text-[var(--text-secondary)]">Rank</span>
                        <span className="text-base font-mono font-semibold text-red-700 dark:text-red-400">
                          {recentResult.rank ? `#${recentResult.rank}` : '--'}
                        </span>
                      </div>
                      <div>
                        <span className="block text-xs text-[var(--text-secondary)]">Finish</span>
                        <span className="text-base font-mono font-semibold text-[var(--text-primary)]">
                          <RaceTimeText value={recentResult.finishTime} />
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {myRunnerProfiles.length > 0 ? (
                  <div className="space-y-2">
                    {myRunnerProfiles.slice(0, 4).map((rp) => {
                      const race = raceById.get(rp.raceId);
                      return (
                        <div key={`${rp.raceId}_${rp.bibNumber}`} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2.5 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs sm:text-sm font-semibold text-[var(--text-primary)] truncate">
                              {race?.name || rp.raceId}
                            </p>
                            <p className="text-xs text-[var(--text-secondary)] truncate">
                              {race?.date || 'Scheduled'} &bull; {rp.distance} &bull; Bib #{rp.bibNumber}
                            </p>
                          </div>
                          <span className="text-xs font-semibold text-[var(--text-secondary)] shrink-0">
                            {race?.completedAt ? 'Completed' : 'Registered'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : displayedEvents.length > 0 ? (
                  <div className="space-y-2">
                    {displayedEvents.slice(0, 4).map((race) => (
                      <div key={race.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2.5 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-semibold text-[var(--text-primary)] truncate">{race.name}</p>
                          <p className="text-xs text-[var(--text-secondary)] truncate">
                            {race.date} &bull; {race.distances.map((d) => d.label).join(' / ') || 'Event'}
                          </p>
                        </div>
                        <span className="text-xs font-semibold text-[var(--text-secondary)] shrink-0">
                          {race.completedAt ? 'Completed' : 'Upcoming'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[var(--text-secondary)] py-2">
                    No recorded races or events yet. Register for an event or create one from your workspace.
                  </p>
                )}
              </section>
            </div>
          </div>
        )}

        {/* TAB 2: ABOUT (FACEBOOK 2-COLUMN STRUCTURED DIRECTORY) */}
        {activeTab === 'about' && (
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] overflow-hidden grid grid-cols-1 lg:grid-cols-12">
            <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-[var(--border-subtle)] p-2 space-y-1">
              <h3 className="px-3 py-2 font-display text-base font-semibold text-[var(--text-primary)]">About</h3>
              {(
                [
                  { id: 'overview', label: 'Overview' },
                  { id: 'work', label: 'Run Club & Distances' },
                  { id: 'places', label: 'Places & Social Links' },
                  { id: 'contact', label: 'Contact & Account Info' },
                  { id: 'kit', label: 'Race Kit & Emergency Info' },
                ] as const
              ).map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setAboutCategory(cat.id)}
                  aria-current={aboutCategory === cat.id ? 'true' : undefined}
                  className={`min-h-11 w-full text-left px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors ${
                    aboutCategory === cat.id
                      ? 'bg-red-700/15 text-red-700 dark:text-red-400'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-card)]'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="lg:col-span-8 p-4 sm:p-5 space-y-4">
              {(aboutCategory === 'overview' || aboutCategory === 'work') && (
                <div className="space-y-3">
                  <AboutRow icon={<Briefcase className="w-4 h-4" aria-hidden="true" />} label="Account Role" value={`${roleLabel(profile.role)} at RacePulsePH`} />
                  <AboutRow icon={<Users className="w-4 h-4" aria-hidden="true" />} label="Run Club / Team" value={runClub.trim() || 'Not set'} onEdit={() => switchTab('edit')} />
                  <AboutRow icon={<Trophy className="w-4 h-4" aria-hidden="true" />} label="Favorite Distance" value={favoriteDistance.trim() || 'Not set'} onEdit={() => switchTab('edit')} />
                </div>
              )}

              {(aboutCategory === 'overview' || aboutCategory === 'places') && (
                <div className="space-y-3">
                  <AboutRow icon={<MapPin className="w-4 h-4" aria-hidden="true" />} label="Home City / Location" value={location.trim() || 'Not set'} onEdit={() => switchTab('edit')} />
                  <AboutRow icon={<Globe className="w-4 h-4" aria-hidden="true" />} label="Athlete / Social Link" value={socialLink.trim() || 'Not set'} onEdit={() => switchTab('edit')} />
                </div>
              )}

              {(aboutCategory === 'overview' || aboutCategory === 'contact') && (
                <div className="space-y-3">
                  <AboutRow icon={<Mail className="w-4 h-4" aria-hidden="true" />} label="Account Email" value={profile.email} />
                  <AboutRow icon={<User className="w-4 h-4" aria-hidden="true" />} label="Sign-in Handle" value={effectiveUsername ? `@${effectiveUsername}` : 'Not claimed yet'} onEdit={profile.username ? undefined : () => switchTab('edit')} />
                  <AboutRow icon={<Calendar className="w-4 h-4" aria-hidden="true" />} label="Member Since" value={formatJoinDate(profile.createdAt)} />
                </div>
              )}

              {aboutCategory === 'kit' && (
                <div className="space-y-3">
                  <AboutRow icon={<PackageCheck className="w-4 h-4" aria-hidden="true" />} label="Preferred Shirt Size" value={shirtSize.trim() || 'Not selected'} onEdit={() => switchTab('edit')} />
                  <AboutRow icon={<HeartPulse className="w-4 h-4" aria-hidden="true" />} label="Emergency Contact" value={emergencyContactName.trim() || 'Not set'} onEdit={() => switchTab('edit')} />
                  <AboutRow icon={<Phone className="w-4 h-4" aria-hidden="true" />} label="Emergency Phone" value={emergencyContactPhone.trim() || 'Not set'} onEdit={() => switchTab('edit')} />
                  <AboutRow icon={<ShieldCheck className="w-4 h-4" aria-hidden="true" />} label="Medical Note" value={medicalNotes.trim() || 'None recorded'} onEdit={() => switchTab('edit')} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: EDIT PROFILE (FULL FACEBOOK EDIT SHEET) */}
        {activeTab === 'edit' && (
          <form onSubmit={(event) => void handleSaveAllProfile(event)} className="space-y-5" aria-busy={saving}>
            {/* Profile Picture Picker */}
            <ProfileAvatarPicker
              photoPreview={photoPreview || null}
              initial={avatarInitial}
              onPhotoChange={(nextPhoto) => {
                setPhotoPreview(nextPhoto);
                setStatusMessage('');
              }}
              onError={setErrorMessage}
            />

            {/* Cover Photo Section */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Cover Photo</p>
                  <p className="text-xs text-[var(--text-secondary)]">Pick a RacePulse banner theme or upload a 720x240 landscape image.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => coverInputRef.current?.click()}
                    disabled={processingMedia}
                    className="min-h-11 px-3 py-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-2"
                  >
                    <ImagePlus className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                    <span>{coverPreview ? 'Change Cover' : 'Upload Cover'}</span>
                  </button>
                  {coverPreview && (
                    <button
                      type="button"
                      onClick={() => setCoverPreview('')}
                      className="min-h-11 px-3 py-2 rounded-xl border border-red-700/35 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-700 hover:text-white inline-flex items-center gap-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Remove Cover</span>
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {COVER_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setCoverPreset(preset.id);
                      setCoverPreview('');
                    }}
                    aria-pressed={!coverPreview && coverPreset === preset.id}
                    className={`min-h-11 px-3 py-2 rounded-xl border text-xs font-semibold inline-flex items-center gap-2 transition-colors ${
                      !coverPreview && coverPreset === preset.id
                        ? 'border-red-700 dark:border-red-400 bg-[var(--surface-card)] text-[var(--text-primary)]'
                        : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-secondary)]'
                    }`}
                  >
                    <span className={`w-4 h-4 rounded-full ${preset.className} shrink-0`} aria-hidden="true" />
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Bio */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={`${dialogId}-bio`} className="block text-sm font-semibold text-[var(--text-primary)]">
                  Bio
                </label>
                <span className="text-xs text-[var(--text-secondary)]">{bio.length}/160</span>
              </div>
              <textarea
                id={`${dialogId}-bio`}
                rows={2}
                maxLength={160}
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                disabled={saving}
                placeholder="Share a quick intro, PR goal, or event team role..."
                className="w-full resize-y rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
              />
            </div>

            {/* Identity & Intro Details */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Identity &amp; Customize Your Intro</h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`${dialogId}-fullname`} className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    Full Name
                  </label>
                  <input
                    id={`${dialogId}-fullname`}
                    type="text"
                    required
                    maxLength={100}
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    disabled={saving}
                    placeholder="Your full name"
                    className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
                  />
                </div>

                <div>
                  <label htmlFor={`${dialogId}-nickname`} className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    Nickname
                  </label>
                  <input
                    id={`${dialogId}-nickname`}
                    type="text"
                    maxLength={30}
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    disabled={saving}
                    placeholder={displayName.trim() || profile.displayName}
                    className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor={`${dialogId}-username`} className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    Sign-in Username (@handle)
                  </label>
                  {profile.username ? (
                    <div className="min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2.5 text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                      <User className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
                      <span>@{profile.username}</span>
                      <span className="ml-auto text-xs font-normal text-[var(--text-secondary)]">Permanent</span>
                    </div>
                  ) : (
                    <>
                      <input
                        id={`${dialogId}-username`}
                        type="text"
                        maxLength={24}
                        autoCapitalize="none"
                        autoCorrect="off"
                        value={username}
                        onChange={(event) => setUsername(event.target.value.toLowerCase())}
                        disabled={saving}
                        placeholder="e.g. juan.runner"
                        className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
                      />
                      <p className="text-xs text-[var(--text-secondary)] mt-1">
                        Optional. Once saved, you can sign in with this username and friends can find you, and it cannot be changed.
                      </p>
                    </>
                  )}
                </div>

                <div>
                  <label htmlFor={`${dialogId}-runclub`} className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    Run Club / Team
                  </label>
                  <input
                    id={`${dialogId}-runclub`}
                    type="text"
                    maxLength={80}
                    value={runClub}
                    onChange={(event) => setRunClub(event.target.value)}
                    disabled={saving}
                    placeholder="e.g. Manila Pacers"
                    className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
                  />
                </div>

                <div>
                  <label htmlFor={`${dialogId}-location`} className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    Home City / Location
                  </label>
                  <input
                    id={`${dialogId}-location`}
                    type="text"
                    maxLength={80}
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                    disabled={saving}
                    placeholder="e.g. Quezon City, Metro Manila"
                    className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
                  />
                </div>

                <div>
                  <label htmlFor={`${dialogId}-distance`} className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    Favorite Distance
                  </label>
                  <Select
                    id={`${dialogId}-distance`}
                    value={favoriteDistance}
                    onChange={setFavoriteDistance}
                    disabled={saving}
                    surface="card"
                    size="md"
                    options={[
                      { value: '', label: 'Not specified' },
                      ...FAVORITE_DISTANCES.map((dist) => ({ value: dist, label: dist })),
                    ]}
                  />
                </div>

                <div>
                  <label htmlFor={`${dialogId}-social`} className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    Athlete / Social Link
                  </label>
                  <input
                    id={`${dialogId}-social`}
                    type="text"
                    maxLength={160}
                    value={socialLink}
                    onChange={(event) => setSocialLink(event.target.value)}
                    disabled={saving}
                    placeholder="e.g. strava.com/athletes/..."
                    className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
                  />
                </div>
              </div>
            </div>

            {/* Race Kit & Emergency Medical */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 space-y-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Race Kit &amp; Emergency Info</h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor={`${dialogId}-shirt`} className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    Shirt Size
                  </label>
                  <Select
                    id={`${dialogId}-shirt`}
                    value={usesCustomShirt ? '__other__' : shirtSize}
                    onChange={(nextValue) => {
                      if (nextValue === '__other__') {
                        setShirtCustomMode(true);
                        setShirtSize('');
                      } else {
                        setShirtCustomMode(false);
                        setShirtSize(nextValue);
                      }
                    }}
                    disabled={saving}
                    surface="card"
                    size="md"
                    options={[
                      { value: '', label: 'Not selected' },
                      ...STANDARD_SHIRT_SIZES.map((size) => ({ value: size, label: size })),
                      { value: '__other__', label: 'Other size' },
                    ]}
                  />
                </div>

                <div>
                  <label htmlFor={`${dialogId}-emergency-name`} className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    Emergency Contact
                  </label>
                  <input
                    id={`${dialogId}-emergency-name`}
                    type="text"
                    maxLength={100}
                    value={emergencyContactName}
                    onChange={(event) => setEmergencyContactName(event.target.value)}
                    disabled={saving}
                    placeholder="Full name"
                    className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
                  />
                </div>

                <div>
                  <label htmlFor={`${dialogId}-emergency-phone`} className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    Contact Number
                  </label>
                  <input
                    id={`${dialogId}-emergency-phone`}
                    type="tel"
                    maxLength={30}
                    value={emergencyContactPhone}
                    onChange={(event) => setEmergencyContactPhone(event.target.value)}
                    disabled={saving}
                    placeholder="09XX XXX XXXX"
                    className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
                  />
                </div>
              </div>

              {usesCustomShirt && (
                <div>
                  <label htmlFor={`${dialogId}-shirt-custom`} className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    Custom Shirt Size
                  </label>
                  <input
                    id={`${dialogId}-shirt-custom`}
                    type="text"
                    maxLength={20}
                    value={shirtSize}
                    onChange={(event) => setShirtSize(event.target.value.toUpperCase())}
                    disabled={saving}
                    placeholder="EX: 7XL, 3XS"
                    className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm uppercase text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
                  />
                </div>
              )}

              <div>
                <label htmlFor={`${dialogId}-medical`} className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                  Medical Note (optional)
                </label>
                <textarea
                  id={`${dialogId}-medical`}
                  rows={2}
                  maxLength={600}
                  value={medicalNotes}
                  onChange={(event) => setMedicalNotes(event.target.value)}
                  disabled={saving}
                  placeholder="Allergy, asthma, or medical info visible only to you and authorized RacePulse staff."
                  className="w-full resize-y rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-700/50 dark:focus:ring-red-400/50"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="min-h-11 w-full py-3 px-5 rounded-xl bg-gradient-to-r from-red-700 to-red-800 hover:from-red-600 hover:to-red-700 text-white font-display font-semibold text-xs sm:text-sm tracking-wide shadow-lg shadow-red-900/25 flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
            >
              {saving ? <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" /> : <User className="w-4 h-4" aria-hidden="true" />}
              <span>{saving ? 'Saving Profile Changes...' : 'Save Profile Changes'}</span>
            </button>
          </form>
        )}

        {/* TAB 4: SETTINGS & SECURITY (ACCOUNTS CENTER STYLE) */}
        {activeTab === 'security' && (
          <div className="space-y-4">
            <PasswordSecuritySection onResetViaEmail={() => setResettingPassword(true)} />

            <label
              htmlFor={`${dialogId}-marketing`}
              className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 flex items-start justify-between gap-4 cursor-pointer"
            >
              <span className="space-y-1">
                <span className="block text-sm font-semibold text-[var(--text-primary)]">
                  Optional event updates &amp; newsletters
                </span>
                <span className="block text-xs text-[var(--text-secondary)] leading-relaxed">
                  Opt in or out of optional RacePulsePH event announcements. Security codes and paid registration receipts are unaffected.
                </span>
              </span>
              <input
                id={`${dialogId}-marketing`}
                type="checkbox"
                disabled={saving}
                checked={marketingOptIn}
                onChange={(event) => void handleToggleMarketing(event.target.checked)}
                className="rp-checkbox shrink-0"
              />
            </label>

            <div className="rounded-xl border border-red-700/30 bg-red-50 dark:bg-red-950/30 p-4 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-red-800 dark:text-red-300">Account Ownership &amp; Deletion</h3>
                <p className="mt-1 text-xs text-[var(--text-secondary)] leading-relaxed">
                  Permanently deletes your RacePulsePH profile, registrations, username handle, and friend directory data, and anonymizes historical payment audit references.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="min-h-11 px-4 rounded-xl border border-red-700 dark:border-red-400 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-700 hover:text-white inline-flex items-center gap-2 transition-colors"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                <span>Delete My Account &amp; Data</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </DialogSurface>
  );
}

function AboutRow({
  icon,
  label,
  value,
  onEdit,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onEdit?: () => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2.5 flex items-center justify-between gap-3">
      <div className="flex items-start gap-3 min-w-0">
        <span className="text-[var(--text-secondary)] mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0">
          <p className="text-xs text-[var(--text-secondary)]">{label}</p>
          <p className="text-sm font-semibold text-[var(--text-primary)] break-words">{value}</p>
        </div>
      </div>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${label}`}
          className="min-h-11 min-w-11 rounded-xl hover:bg-[var(--surface-inset)] text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400 flex items-center justify-center shrink-0 transition-colors"
        >
          <Pencil className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
