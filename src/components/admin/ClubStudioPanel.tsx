import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  Archive,
  Building2,
  Check,
  Crown,
  Moon,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  Sun,
  Trash2,
  Upload,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { db } from '../../firebase';
import { useAccess } from '../../lib/access';
import { subscribeBadgeCatalog } from '../../lib/badges/client';
import { E2E_BADGES_KEY, E2E_RACES_KEY, E2E_USERS_KEY } from '../../lib/badges/e2eFixtures';
import type { BadgeDefinition } from '../../lib/badges/types';
import {
  archiveClubDefinition,
  deleteClubDefinition,
  manageClubMember,
  resolveClubRequest,
  saveClubDefinition,
  subscribeClubCatalog,
  subscribeClubMembers,
  subscribeClubRequests,
  uploadClubAsset,
} from '../../lib/clubs/client';
import {
  E2E_CLUBS_KEY,
  E2E_CLUB_MEMBERS_KEY,
  E2E_CLUB_REQUESTS_KEY,
  archiveDevClubFixture,
  deleteDevClubFixture,
  manageDevClubMemberFixture,
  readDevSessionJson,
  resolveDevClubRequestFixture,
  saveDevClubFixture,
  uploadDevClubAssetFixture,
} from '../../lib/clubs/e2eFixtures';
import {
  CLUB_BILLING_META,
  CLUB_BILLING_PROVIDERS,
  CLUB_BILLING_TIERS,
  CLUB_JOIN_POLICIES,
  CLUB_JOIN_POLICY_META,
  CLUB_MODULES,
  CLUB_MODULE_META,
  CLUB_SUBSCRIPTION_STATUSES,
  slugifyClubId,
} from '../../lib/clubs/presets';
import {
  CLUB_STUDIO_COLOR_SWATCHES,
  clubDefinitionToDraft,
  clubRequestToDraft,
  createBlankClubDraft,
  draftToPreviewClub,
  normalizeStudioHexColor,
  validateAndBuildClubSavePayload,
  type ClubDraftFieldKey,
  type ClubFormDraft,
} from '../../lib/clubs/studioDraft';
import type {
  ClubBillingProvider,
  ClubBillingTier,
  ClubDefinition,
  ClubJoinPolicy,
  ClubMemberRecord,
  ClubModuleKey,
  ClubRequestRecord,
  ClubSubscriptionStatus,
} from '../../lib/clubs/types';
import { subscribeSharedRaces } from '../../lib/racesStore';
import { subscribePublishedCatalog } from '../../lib/routes/routeStore';
import type { RaceRouteCatalogEntry } from '../../lib/routes/types';
import type { Race, UserProfile } from '../../types';
import { useFeedback } from '../ui/FeedbackProvider';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, type SelectOption } from '../ui/Select';

type ClubStudioTab = 'studio' | 'requests' | 'members';

interface ClubStudioPanelProps {
  profile: UserProfile;
}

const VALID_UID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function HexColorControl({
  id,
  label,
  value,
  disabled,
  errorText,
  showError,
  onChange,
  onBlurTouch,
  inputRef,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  errorText?: string;
  showError: boolean;
  onChange: (nextColor: string) => void;
  onBlurTouch: () => void;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  const safeHex = normalizeStudioHexColor(value, '#DC2626');
  const errorId = `${id}-err`;
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs font-semibold text-[var(--text-primary)]">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          disabled={disabled}
          value={safeHex}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="w-11 h-11 p-1 rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] cursor-pointer shrink-0 disabled:opacity-50"
        />
        <Input
          ref={inputRef}
          id={id}
          value={value}
          maxLength={7}
          disabled={disabled}
          aria-invalid={showError ? 'true' : 'false'}
          aria-describedby={showError ? errorId : undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            onBlurTouch();
            onChange(normalizeStudioHexColor(value, safeHex));
          }}
          placeholder="#DC2626"
          className="font-mono uppercase"
        />
      </div>
      {showError && errorText && (
        <p id={errorId} className="text-xs font-semibold text-red-700 dark:text-red-400">
          {errorText}
        </p>
      )}
      <div className="flex flex-wrap gap-1" role="group" aria-label={`${label} quick swatches`}>
        {CLUB_STUDIO_COLOR_SWATCHES.map((swatch) => {
          const isSelected = safeHex === swatch.toUpperCase();
          return (
            <button
              key={swatch}
              type="button"
              disabled={disabled}
              aria-label={`Use ${swatch} for ${label}`}
              aria-pressed={isSelected}
              onClick={() => onChange(swatch)}
              className={`min-h-11 min-w-11 rounded-xl border flex items-center justify-center ${
                isSelected
                  ? 'border-red-600 dark:border-red-400 bg-red-500/10'
                  : 'border-[var(--border-control)] bg-[var(--surface-inset)] hover:border-[var(--border-strong)]'
              }`}
            >
              <span
                className="w-6 h-6 rounded-full border border-black/15 dark:border-white/25"
                style={{ backgroundColor: swatch }}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ClubStudioPanel({ profile }: ClubStudioPanelProps) {
  const { can, authority: isSuperAdmin } = useAccess();
  const { confirm, notify } = useFeedback();

  const canView = isSuperAdmin || can('clubs.view');
  const canManage = isSuperAdmin || can('clubs.manage');
  const canViewUsers = isSuperAdmin || can('users.view');
  const isE2eFixtureMode = import.meta.env.DEV && profile.uid.startsWith('e2e-');

  const baseId = useId();
  const mountedRef = useRef(true);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const fieldRefs = useRef<Partial<Record<ClubDraftFieldKey, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const logoFileRef = useRef<HTMLInputElement | null>(null);
  const coverFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [subTab, setSubTab] = useState<ClubStudioTab>('studio');
  const [clubs, setClubs] = useState<ClubDefinition[]>([]);
  const [clubsLoaded, setClubsLoaded] = useState(false);
  const [clubsError, setClubsError] = useState<string | null>(null);

  const [requests, setRequests] = useState<ClubRequestRecord[]>([]);
  const [requestsLoaded, setRequestsLoaded] = useState(false);
  const [requestFilter, setRequestFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [requestNote, setRequestNote] = useState('');
  const [resolvingRequestId, setResolvingRequestId] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('all');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [editingClubId, setEditingClubId] = useState<string | null>(null);
  const [idManuallyEdited, setIdManuallyEdited] = useState(false);
  const [draft, setDraft] = useState<ClubFormDraft>(() => createBlankClubDraft());
  const [touchedFields, setTouchedFields] = useState<Partial<Record<ClubDraftFieldKey, boolean>>>({});
  const [submittedOnce, setSubmittedOnce] = useState(false);
  const [liveErrorAnnouncement, setLiveErrorAnnouncement] = useState('');
  const [previewBackdrop, setPreviewBackdrop] = useState<'dark' | 'light'>('dark');

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [captainSearch, setCaptainSearch] = useState('');
  const [manualCaptainUid, setManualCaptainUid] = useState('');
  const [badges, setBadges] = useState<BadgeDefinition[]>([]);
  const [races, setRaces] = useState<Race[]>([]);
  const [routes, setRoutes] = useState<RaceRouteCatalogEntry[]>([]);

  const [selectedRosterClubId, setSelectedRosterClubId] = useState('');
  const [rosterMembers, setRosterMembers] = useState<ClubMemberRecord[]>([]);
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [rosterSearch, setRosterSearch] = useState('');
  const [memberActionUid, setMemberActionUid] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<'logo' | 'cover' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const isMutating = saving || archiving || deleting || uploadingKind !== null;

  useEffect(() => {
    if (!canView) return;
    if (isE2eFixtureMode) {
      setClubs(readDevSessionJson<ClubDefinition>(E2E_CLUBS_KEY) ?? []);
      setClubsLoaded(true);
      setClubsError(null);
      return;
    }
    return subscribeClubCatalog(
      (snap) => {
        setClubs(snap.clubs);
        setClubsLoaded(snap.loaded);
        setClubsError(snap.error);
      },
      { includeArchived: true },
    );
  }, [canView, isE2eFixtureMode]);

  useEffect(() => {
    if (!canView) return;
    if (isE2eFixtureMode) {
      setRequests(readDevSessionJson<ClubRequestRecord>(E2E_CLUB_REQUESTS_KEY) ?? []);
      setRequestsLoaded(true);
      return;
    }
    return subscribeClubRequests((snap) => {
      setRequests(snap.requests);
      setRequestsLoaded(snap.loaded);
    });
  }, [canView, isE2eFixtureMode]);

  useEffect(() => {
    if (!canView) return;
    if (isE2eFixtureMode) {
      setBadges(readDevSessionJson<BadgeDefinition>(E2E_BADGES_KEY) ?? []);
      setRaces(readDevSessionJson<Race>(E2E_RACES_KEY) ?? []);
      setUsers(readDevSessionJson<UserProfile>(E2E_USERS_KEY) ?? []);
      return;
    }
    const unsubs: Array<() => void> = [];
    unsubs.push(subscribeBadgeCatalog((s) => setBadges(s.badges)));
    unsubs.push(
      subscribeSharedRaces((list, loaded) => {
        if (loaded) setRaces(list);
      }),
    );
    unsubs.push(subscribePublishedCatalog((list) => setRoutes(list)));
    if (canViewUsers) {
      unsubs.push(
        onSnapshot(
          collection(db, 'users'),
          (snap) => setUsers(snap.docs.map((d) => d.data() as UserProfile)),
          () => setUsers([]),
        ),
      );
    }
    return () => unsubs.forEach((u) => u());
  }, [canView, canViewUsers, isE2eFixtureMode]);

  const effectiveRosterClubId =
    selectedRosterClubId && clubs.some((c) => c.clubId === selectedRosterClubId)
      ? selectedRosterClubId
      : clubs[0]?.clubId || '';

  useEffect(() => {
    if (!canView || !effectiveRosterClubId) {
      setRosterMembers([]);
      setRosterLoaded(true);
      return;
    }
    if (isE2eFixtureMode) {
      const all = readDevSessionJson<ClubMemberRecord>(E2E_CLUB_MEMBERS_KEY) ?? [];
      setRosterMembers(all.filter((m) => m.clubId === effectiveRosterClubId));
      setRosterLoaded(true);
      return;
    }
    setRosterLoaded(false);
    return subscribeClubMembers(
      effectiveRosterClubId,
      (snap) => {
        setRosterMembers(snap.members);
        setRosterLoaded(snap.loaded);
      },
      { includePending: true },
    );
  }, [canView, effectiveRosterClubId, isE2eFixtureMode]);

  useEffect(() => {
    if (!canManage && editingClubId === null && clubs.length > 0) {
      setEditingClubId(clubs[0].clubId);
      setIdManuallyEdited(true);
      setDraft(clubDefinitionToDraft(clubs[0]));
    }
  }, [canManage, clubs, editingClubId]);

  const pendingRequestsCount = useMemo(
    () => requests.filter((r) => r.status === 'pending').length,
    [requests],
  );

  const visibleClubs = useMemo(() => {
    const term = catalogSearch.trim().toLowerCase();
    return clubs.filter((club) => {
      if (statusFilter !== 'all' && club.status !== statusFilter) return false;
      if (!term) return true;
      return `${club.name} ${club.clubId} ${club.city} ${club.description}`
        .toLowerCase()
        .includes(term);
    });
  }, [catalogSearch, clubs, statusFilter]);

  const validation = useMemo(() => validateAndBuildClubSavePayload(draft), [draft]);
  const fieldErrors = validation.ok ? {} : validation.fieldErrors;
  const previewClub = useMemo(() => draftToPreviewClub(draft, profile.uid), [draft, profile.uid]);

  const usersByUid = useMemo(() => {
    const map = new Map<string, UserProfile>();
    for (const u of users) map.set(u.uid, u);
    return map;
  }, [users]);

  const filteredCaptainCandidates = useMemo(() => {
    const term = captainSearch.trim().toLowerCase();
    const active = users.filter((u) => !u.accessRemoved && !draft.captainUids.includes(u.uid));
    if (!term) return active.slice(0, 6);
    return active
      .filter((u) =>
        `${u.displayName} ${u.username || ''} ${u.email || ''} ${u.uid}`
          .toLowerCase()
          .includes(term),
      )
      .slice(0, 8);
  }, [captainSearch, draft.captainUids, users]);

  const statusFilterOptions: SelectOption[] = [
    { value: 'all', label: 'All clubs' },
    { value: 'active', label: 'Active only' },
    { value: 'archived', label: 'Archived only' },
  ];

  const joinPolicyOptions: SelectOption[] = CLUB_JOIN_POLICIES.map((p) => ({
    value: p,
    label: CLUB_JOIN_POLICY_META[p].label,
    sublabel: CLUB_JOIN_POLICY_META[p].hint,
  }));

  const billingTierOptions: SelectOption[] = CLUB_BILLING_TIERS.map((tier) => ({
    value: tier,
    label: CLUB_BILLING_META[tier].label,
    sublabel: CLUB_BILLING_META[tier].summary,
  }));

  const subscriptionStatusOptions: SelectOption[] = CLUB_SUBSCRIPTION_STATUSES.map((s) => ({
    value: s,
    label: s === 'past_due' ? 'Past Due' : s.charAt(0).toUpperCase() + s.slice(1),
  }));

  const billingProviderOptions: SelectOption[] = CLUB_BILLING_PROVIDERS.map((p) => ({
    value: p,
    label: p === 'admin_manual' ? 'Admin Manual Setup' : 'PayMongo (When Approved)',
  }));

  const clubSelectOptions: SelectOption[] = clubs.map((c) => ({
    value: c.clubId,
    label: c.name,
    sublabel: `${c.city} | ${c.memberCount} members`,
  }));

  const resetFormToNew = () => {
    setEditingClubId(null);
    setIdManuallyEdited(false);
    setDraft(createBlankClubDraft());
    setTouchedFields({});
    setSubmittedOnce(false);
    setFormError(null);
    setLiveErrorAnnouncement('');
  };

  const selectClubForEditing = (club: ClubDefinition) => {
    setEditingClubId(club.clubId);
    setIdManuallyEdited(true);
    setDraft(clubDefinitionToDraft(club));
    setTouchedFields({});
    setSubmittedOnce(false);
    setFormError(null);
    setLiveErrorAnnouncement('');
  };

  const touchField = (key: ClubDraftFieldKey) => {
    setTouchedFields((prev) => ({ ...prev, [key]: true }));
  };

  const isFieldErrorShown = (key: ClubDraftFieldKey): boolean =>
    Boolean(fieldErrors[key] && (submittedOnce || touchedFields[key]));

  const toggleModule = (key: ClubModuleKey, enabled: boolean) => {
    setDraft((prev) => ({
      ...prev,
      modules: { ...prev.modules, [key]: enabled },
    }));
  };

  const toggleIdSelection = (
    field: 'captainUids' | 'linkedBadgeIds' | 'featuredRouteIds' | 'linkedRaceIds',
    id: string,
    max: number,
  ) => {
    setDraft((prev) => {
      const current = prev[field];
      if (current.includes(id)) {
        return { ...prev, [field]: current.filter((x) => x !== id) };
      }
      if (current.length >= max) return prev;
      return { ...prev, [field]: [...current, id] };
    });
  };

  const handleAssetUpload = async (kind: 'logo' | 'cover', file: File | undefined) => {
    if (!file || !canManage) return;
    const targetClubId = draft.clubId.trim() || slugifyClubId(draft.name || 'new_club');
    if (!draft.clubId.trim()) {
      setDraft((prev) => ({ ...prev, clubId: targetClubId }));
    }
    setUploadingKind(kind);
    setFormError(null);
    try {
      const uploaded = isE2eFixtureMode
        ? await uploadDevClubAssetFixture(profile.uid, targetClubId, kind, file)
        : await uploadClubAsset(profile.uid, targetClubId, kind, file);
      if (!mountedRef.current) return;
      setDraft((prev) =>
        kind === 'logo'
          ? { ...prev, logoUrl: uploaded.url, logoStoragePath: uploaded.storagePath }
          : { ...prev, coverUrl: uploaded.url, coverStoragePath: uploaded.storagePath },
      );
      notify({
        tone: 'success',
        title: kind === 'logo' ? 'Logo uploaded' : 'Cover uploaded',
        message: 'Save the club profile to apply the uploaded image.',
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setFormError(err instanceof Error ? err.message : 'Unable to upload image.');
    } finally {
      if (mountedRef.current) setUploadingKind(null);
    }
  };

  const handleSaveClub = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!canManage || isMutating) return;
    setSubmittedOnce(true);
    setFormError(null);

    if (!validation.ok) {
      const orderedKeys: ClubDraftFieldKey[] = [
        'name',
        'clubId',
        'city',
        'scheduleSummary',
        'description',
        'memberLimit',
        'primaryColor',
        'accentColor',
      ];
      const firstBad = orderedKeys.find((k) => Boolean(validation.fieldErrors[k]));
      if (firstBad) {
        fieldRefs.current[firstBad]?.focus();
      }
      const msg = validation.errors[0] || 'Check highlighted club settings before saving.';
      setFormError(msg);
      setLiveErrorAnnouncement(msg);
      return;
    }

    setSaving(true);
    try {
      const saved = isE2eFixtureMode
        ? saveDevClubFixture(clubs, draft, profile.uid).saved
        : (await saveClubDefinition(validation.payload)).club;
      if (!mountedRef.current) return;
      if (isE2eFixtureMode) {
        setClubs(readDevSessionJson<ClubDefinition>(E2E_CLUBS_KEY) ?? []);
      }
      setEditingClubId(saved.clubId);
      setIdManuallyEdited(true);
      setDraft(clubDefinitionToDraft(saved));
      notify({
        tone: 'success',
        title: 'Club saved',
        message: `${saved.name} (${saved.clubId}) is updated.`,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'Could not save club.';
      setFormError(msg);
      setLiveErrorAnnouncement(msg);
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const handleArchiveToggle = async () => {
    if (!canManage || !editingClubId || isMutating) return;
    const editingClub = clubs.find((c) => c.clubId === editingClubId);
    if (!editingClub) return;
    const nextArchived = editingClub.status === 'active';
    setArchiving(true);
    setFormError(null);
    try {
      if (isE2eFixtureMode) {
        const nextList = archiveDevClubFixture(
          clubs,
          editingClubId,
          nextArchived ? 'archived' : 'active',
        );
        setClubs(nextList);
      } else {
        await archiveClubDefinition(editingClubId, nextArchived);
      }
      if (!mountedRef.current) return;
      setDraft((prev) => ({ ...prev, status: nextArchived ? 'archived' : 'active' }));
      notify({
        tone: 'success',
        title: nextArchived ? 'Club archived' : 'Club restored',
        message: `${editingClub.name} status updated.`,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setFormError(err instanceof Error ? err.message : 'Unable to update club status.');
    } finally {
      if (mountedRef.current) setArchiving(false);
    }
  };

  const handleDeleteClub = async () => {
    if (!canManage || !editingClubId || isMutating) return;
    const targetClub = clubs.find((c) => c.clubId === editingClubId);
    if (!targetClub) return;
    const ok = await confirm({
      title: `Delete ${targetClub.name}?`,
      message: 'This removes the club, its member roster, announcements, meetups, and group chat.',
      confirmLabel: 'Delete Club',
      destructive: true,
    });
    if (!ok) return;

    setDeleting(true);
    setFormError(null);
    try {
      if (isE2eFixtureMode) {
        setClubs(deleteDevClubFixture(clubs, targetClub.clubId));
      } else {
        await deleteClubDefinition(targetClub.clubId);
      }
      if (!mountedRef.current) return;
      notify({
        tone: 'success',
        title: 'Club deleted',
        message: `${targetClub.name} was removed.`,
      });
      resetFormToNew();
    } catch (err) {
      if (!mountedRef.current) return;
      setFormError(err instanceof Error ? err.message : 'Could not delete club.');
    } finally {
      if (mountedRef.current) setDeleting(false);
    }
  };

  const handleResolveRequest = async (
    req: ClubRequestRecord,
    decision: 'approved' | 'rejected',
  ) => {
    if (!canManage || resolvingRequestId) return;
    setResolvingRequestId(req.requestId);
    try {
      const draftFromReq = clubRequestToDraft(req);
      const checked = validateAndBuildClubSavePayload(draftFromReq);
      if (isE2eFixtureMode) {
        const out = resolveDevClubRequestFixture(requests, clubs, {
          clubRequestId: req.requestId,
          decision,
          reviewNote: requestNote.trim(),
          actorUid: profile.uid,
          clubPayload: decision === 'approved' ? draftFromReq : undefined,
        });
        setRequests(out.requests);
        setClubs(out.clubs);
      } else {
        await resolveClubRequest({
          clubRequestId: req.requestId,
          decision,
          reviewNote: requestNote.trim() || undefined,
          clubPayload: decision === 'approved' && checked.ok ? checked.payload : undefined,
        });
      }
      if (!mountedRef.current) return;
      setRequestNote('');
      notify({
        tone: 'success',
        title: decision === 'approved' ? 'Club request approved' : 'Club request rejected',
        message: req.clubName,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Request update failed',
        message: err instanceof Error ? err.message : 'Unable to resolve club request.',
      });
    } finally {
      if (mountedRef.current) setResolvingRequestId(null);
    }
  };

  const handleRosterAction = async (
    member: ClubMemberRecord,
    action: 'approve' | 'reject' | 'remove' | 'promote_captain' | 'demote_captain',
  ) => {
    if (!canManage || !effectiveRosterClubId || memberActionUid) return;
    if (action === 'remove' || action === 'reject') {
      const confirmed = await confirm({
        title: action === 'reject' ? 'Reject join request?' : 'Remove member from club?',
        message: `${member.displayName || member.uid} will be removed from this club roster.`,
        confirmLabel: action === 'reject' ? 'Reject Request' : 'Remove Member',
        destructive: true,
      });
      if (!confirmed) return;
    }
    setMemberActionUid(member.uid);
    try {
      if (isE2eFixtureMode) {
        const res = manageDevClubMemberFixture(rosterMembers, clubs, {
          clubId: effectiveRosterClubId,
          targetUid: member.uid,
          action,
          displayName: member.displayName,
        });
        setRosterMembers(res.members.filter((m) => m.clubId === effectiveRosterClubId));
        setClubs(res.clubs);
      } else {
        await manageClubMember({
          clubId: effectiveRosterClubId,
          targetUid: member.uid,
          action,
        });
      }
      if (!mountedRef.current) return;
      notify({
        tone: 'success',
        title: 'Roster updated',
        message: `Updated ${member.displayName || member.uid}.`,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      notify({
        tone: 'error',
        title: 'Roster update failed',
        message: err instanceof Error ? err.message : 'Action rejected.',
      });
    } finally {
      if (mountedRef.current) setMemberActionUid(null);
    }
  };

  const handleTabKeyDown = (ev: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const order: ClubStudioTab[] = ['studio', 'requests', 'members'];
    let targetIndex = -1;
    if (ev.key === 'ArrowRight') targetIndex = (currentIndex + 1) % order.length;
    if (ev.key === 'ArrowLeft') targetIndex = (currentIndex - 1 + order.length) % order.length;
    if (ev.key === 'Home') targetIndex = 0;
    if (ev.key === 'End') targetIndex = order.length - 1;
    if (targetIndex < 0) return;
    ev.preventDefault();
    const nextTab = order[targetIndex];
    setSubTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  if (!canView) {
    return (
      <div className="w-full max-w-[1600px] mx-auto">
        <div className="glass-panel p-6 sm:p-8 flex items-start gap-4">
          <ShieldAlert className="w-6 h-6 text-red-700 dark:text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <h2 className="text-lg font-semibold font-display text-[var(--text-primary)]">
              Club Studio access required
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              Ask a Super Admin to enable clubs.view or clubs.manage before opening Club Studio.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const editingClub = editingClubId ? clubs.find((c) => c.clubId === editingClubId) || null : null;
  const visibleRequests = requests.filter((r) => r.status === requestFilter);
  const filteredRoster = rosterMembers.filter((m) => {
    const term = rosterSearch.trim().toLowerCase();
    if (!term) return true;
    return `${m.displayName || ''} ${m.username || ''} ${m.uid} ${m.role} ${m.status}`
      .toLowerCase()
      .includes(term);
  });

  const studioTabs: Array<{ id: ClubStudioTab; label: string; count?: number }> = [
    { id: 'studio', label: 'Club Studio' },
    { id: 'requests', label: 'Club Requests', count: pendingRequestsCount },
    { id: 'members', label: 'Members & Captains' },
  ];

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6">
      <div className="sr-only" aria-live="polite">
        {liveErrorAnnouncement}
      </div>

      <header className="glass-panel p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h2 className="text-xl sm:text-2xl font-semibold font-display text-[var(--text-primary)] tracking-tight">
              Club Studio
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              Create customizable community running clubs, delegate captains, enable modules, and review club applications.
            </p>
          </div>
          {canManage && subTab === 'studio' && (
            <Button
              type="button"
              disabled={isMutating}
              onClick={resetFormToNew}
              className="min-h-11 bg-red-700 hover:bg-red-600 text-white shrink-0"
            >
              <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Create New Club</span>
            </Button>
          )}
        </div>

        <div
          role="tablist"
          aria-label="Club Studio sections"
          className="flex flex-wrap gap-2 pt-3 border-t border-[var(--border-subtle)]"
        >
          {studioTabs.map((item, idx) => {
            const isSelected = subTab === item.id;
            return (
              <button
                key={item.id}
                ref={(el) => {
                  tabRefs.current[item.id] = el;
                }}
                id={`${baseId}-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-controls={`${baseId}-panel-${item.id}`}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => setSubTab(item.id)}
                onKeyDown={(ev) => handleTabKeyDown(ev, idx)}
                className={`min-h-11 px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                  isSelected
                    ? 'bg-red-700 text-white'
                    : 'border border-[var(--border-control)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                }`}
              >
                <span>{item.label}</span>
                {typeof item.count === 'number' && item.count > 0 && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-mono ${
                      isSelected
                        ? 'bg-white/20 text-white'
                        : 'bg-red-700 text-white'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {subTab === 'studio' && (
        <div
          id={`${baseId}-panel-studio`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-studio`}
          className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start"
        >
          <aside className="xl:col-span-3 glass-panel p-4 sm:p-5 space-y-4 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:flex xl:flex-col">
            <div className="flex items-center justify-between gap-2 shrink-0">
              <h3 className="text-base font-semibold font-display text-[var(--text-primary)]">
                Clubs ({clubs.length})
              </h3>
            </div>

            <search className="space-y-2.5 shrink-0">
              <div className="relative">
                <label htmlFor={`${baseId}-club-search`} className="sr-only">
                  Search clubs
                </label>
                <Search
                  className="w-4 h-4 text-[var(--text-secondary)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <Input
                  id={`${baseId}-club-search`}
                  type="search"
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder="Search clubs or cities"
                  className="pl-10"
                />
              </div>
              <Select
                id={`${baseId}-club-status-filter`}
                ariaLabel="Filter clubs by status"
                value={statusFilter}
                options={statusFilterOptions}
                onChange={(val) => setStatusFilter(val as 'all' | 'active' | 'archived')}
              />
            </search>

            {clubsError && (
              <div
                role="alert"
                className="rounded-xl border border-red-600/40 bg-red-500/10 px-3 py-2.5 text-xs font-semibold text-red-700 dark:text-red-300"
              >
                {clubsError}
              </div>
            )}

            {!clubsLoaded ? (
              <p role="status" className="text-xs text-[var(--text-secondary)] py-4">
                Loading club directory...
              </p>
            ) : visibleClubs.length === 0 ? (
              <div className="glass-inset p-5 text-center space-y-2">
                <Building2 className="w-6 h-6 mx-auto text-[var(--text-secondary)]" aria-hidden="true" />
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {clubs.length === 0 ? 'No clubs created yet' : 'No matching clubs'}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Fill out the studio form to launch your first Manila or provincial running club.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[32rem] xl:flex-1 xl:min-h-0 xl:max-h-none overflow-y-auto pr-1">
                {visibleClubs.map((club) => {
                  const selected = editingClubId === club.clubId;
                  return (
                    <button
                      key={club.clubId}
                      type="button"
                      disabled={isMutating}
                      onClick={() => selectClubForEditing(club)}
                      aria-current={selected ? 'true' : undefined}
                      className={`w-full min-h-11 p-3 rounded-xl border text-left flex items-center gap-3 disabled:opacity-60 ${
                        selected
                          ? 'border-red-600 dark:border-red-400 bg-red-500/10'
                          : 'border-[var(--border-control)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)]'
                      }`}
                    >
                      <span
                        className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-sm font-semibold text-white overflow-hidden"
                        style={{ backgroundColor: club.primaryColor || '#DC2626' }}
                        aria-hidden="true"
                      >
                        {club.logoUrl ? (
                          <img src={club.logoUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          club.name.charAt(0).toUpperCase()
                        )}
                      </span>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                          {club.name}
                        </p>
                        <p className="text-xs text-[var(--text-secondary)] truncate">
                          {club.city} ({club.memberCount} members)
                        </p>
                      </div>
                      {club.status === 'archived' && (
                        <span className="px-2 py-0.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-primary)] shrink-0">
                          Archived
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          <section className="xl:col-span-5 glass-panel p-4 sm:p-6">
            <form onSubmit={handleSaveClub} noValidate className="space-y-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold font-display text-[var(--text-primary)]">
                  {editingClub ? `Editing ${editingClub.name}` : 'New Running Club'}
                </h3>
                {editingClub && (
                  <span className="font-mono text-xs text-[var(--text-secondary)]">
                    {editingClub.clubId}
                  </span>
                )}
              </div>

              {formError && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-600/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-700 dark:text-red-300"
                >
                  {formError}
                </div>
              )}

              <fieldset className="space-y-4">
                <legend className="text-sm font-semibold font-display text-[var(--text-primary)]">
                  Identity & Schedule
                </legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label htmlFor={`${baseId}-name`} className="block text-xs font-semibold text-[var(--text-primary)]">
                      Club Name
                    </label>
                    <Input
                      ref={(el) => {
                        fieldRefs.current.name = el;
                      }}
                      id={`${baseId}-name`}
                      disabled={!canManage}
                      value={draft.name}
                      aria-invalid={isFieldErrorShown('name') ? 'true' : 'false'}
                      aria-describedby={isFieldErrorShown('name') ? `${baseId}-name-err` : undefined}
                      onBlur={() => touchField('name')}
                      onChange={(e) => {
                        const nextName = e.target.value;
                        setDraft((prev) => ({
                          ...prev,
                          name: nextName,
                          clubId: !editingClub && !idManuallyEdited ? slugifyClubId(nextName) : prev.clubId,
                        }));
                      }}
                      placeholder="Manila Sunrise Pacers"
                    />
                    {isFieldErrorShown('name') && (
                      <p id={`${baseId}-name-err`} className="text-xs font-semibold text-red-700 dark:text-red-400">
                        {fieldErrors.name}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor={`${baseId}-clubId`} className="block text-xs font-semibold text-[var(--text-primary)]">
                      Club ID Slug
                    </label>
                    <Input
                      ref={(el) => {
                        fieldRefs.current.clubId = el;
                      }}
                      id={`${baseId}-clubId`}
                      disabled={!canManage || Boolean(editingClub)}
                      value={draft.clubId}
                      aria-invalid={isFieldErrorShown('clubId') ? 'true' : 'false'}
                      aria-describedby={isFieldErrorShown('clubId') ? `${baseId}-clubId-err` : undefined}
                      onBlur={() => touchField('clubId')}
                      onChange={(e) => {
                        setIdManuallyEdited(true);
                        setDraft((prev) => ({ ...prev, clubId: e.target.value }));
                      }}
                      placeholder="manila_sunrise_pacers"
                      className="font-mono"
                    />
                    {isFieldErrorShown('clubId') && (
                      <p id={`${baseId}-clubId-err`} className="text-xs font-semibold text-red-700 dark:text-red-400">
                        {fieldErrors.clubId}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor={`${baseId}-city`} className="block text-xs font-semibold text-[var(--text-primary)]">
                      Home City / Hub
                    </label>
                    <Input
                      ref={(el) => {
                        fieldRefs.current.city = el;
                      }}
                      id={`${baseId}-city`}
                      disabled={!canManage}
                      value={draft.city}
                      aria-invalid={isFieldErrorShown('city') ? 'true' : 'false'}
                      aria-describedby={isFieldErrorShown('city') ? `${baseId}-city-err` : undefined}
                      onBlur={() => touchField('city')}
                      onChange={(e) => setDraft((prev) => ({ ...prev, city: e.target.value }))}
                      placeholder="BGC, Taguig"
                    />
                    {isFieldErrorShown('city') && (
                      <p id={`${baseId}-city-err`} className="text-xs font-semibold text-red-700 dark:text-red-400">
                        {fieldErrors.city}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor={`${baseId}-schedule`} className="block text-xs font-semibold text-[var(--text-primary)]">
                      Weekly Schedule
                    </label>
                    <Input
                      ref={(el) => {
                        fieldRefs.current.scheduleSummary = el;
                      }}
                      id={`${baseId}-schedule`}
                      disabled={!canManage}
                      value={draft.scheduleSummary}
                      aria-invalid={isFieldErrorShown('scheduleSummary') ? 'true' : 'false'}
                      aria-describedby={
                        isFieldErrorShown('scheduleSummary') ? `${baseId}-schedule-err` : undefined
                      }
                      onBlur={() => touchField('scheduleSummary')}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, scheduleSummary: e.target.value }))
                      }
                      placeholder="Tue & Sat 05:30 AM PHT"
                    />
                    {isFieldErrorShown('scheduleSummary') && (
                      <p id={`${baseId}-schedule-err`} className="text-xs font-semibold text-red-700 dark:text-red-400">
                        {fieldErrors.scheduleSummary}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor={`${baseId}-description`} className="block text-xs font-semibold text-[var(--text-primary)]">
                    Description
                  </label>
                  <textarea
                    ref={(el) => {
                      fieldRefs.current.description = el;
                    }}
                    id={`${baseId}-description`}
                    rows={3}
                    disabled={!canManage}
                    value={draft.description}
                    aria-invalid={isFieldErrorShown('description') ? 'true' : 'false'}
                    aria-describedby={isFieldErrorShown('description') ? `${baseId}-desc-err` : undefined}
                    onBlur={() => touchField('description')}
                    onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="Share pace groups, meetup points, hydration stops, and training goals."
                    className="w-full rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                  />
                  {isFieldErrorShown('description') && (
                    <p id={`${baseId}-desc-err`} className="text-xs font-semibold text-red-700 dark:text-red-400">
                      {fieldErrors.description}
                    </p>
                  )}
                </div>
              </fieldset>

              <div className="border-t border-[var(--border-subtle)] pt-5">
                <fieldset className="space-y-3">
                  <legend className="text-sm font-semibold font-display text-[var(--text-primary)]">
                    Modular Features ({CLUB_MODULES.filter((k) => draft.modules[k]).length} / {CLUB_MODULES.length} active)
                  </legend>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {CLUB_MODULES.map((modKey) => {
                      const meta = CLUB_MODULE_META[modKey];
                      const enabled = draft.modules[modKey] === true;
                      const switchId = `${baseId}-mod-${modKey}`;
                      return (
                        <label
                          key={modKey}
                          htmlFor={switchId}
                          className="min-h-11 p-3 rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] flex items-start justify-between gap-3 cursor-pointer"
                        >
                          <span className="min-w-0 space-y-0.5">
                            <span className="block text-xs font-semibold text-[var(--text-primary)]">
                              {meta.label}
                            </span>
                            <span className="block text-xs text-[var(--text-secondary)] leading-snug">
                              {meta.description}
                            </span>
                          </span>
                          <input
                            id={switchId}
                            type="checkbox"
                            role="switch"
                            aria-checked={enabled}
                            {...({ switch: '' } as Record<string, unknown>)}
                            disabled={!canManage}
                            checked={enabled}
                            onChange={(e) => toggleModule(modKey, e.target.checked)}
                            className="access-switch shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
                          />
                        </label>
                      );
                    })}
                  </div>

                  {draft.modules.badges && badges.length > 0 && (
                    <div className="glass-inset p-3.5 space-y-2">
                      <p className="text-xs font-semibold text-[var(--text-primary)]">
                        Linked Club Badges ({draft.linkedBadgeIds.length} / 50)
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {badges.slice(0, 18).map((b) => {
                          const picked = draft.linkedBadgeIds.includes(b.badgeId);
                          return (
                            <button
                              key={b.badgeId}
                              type="button"
                              disabled={!canManage}
                              aria-pressed={picked}
                              onClick={() => toggleIdSelection('linkedBadgeIds', b.badgeId, 50)}
                              className={`min-h-11 px-3 py-1.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 ${
                                picked
                                  ? 'border-red-600 bg-red-700 text-white'
                                  : 'border-[var(--border-control)] bg-[var(--surface-card)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                              }`}
                            >
                              {picked && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                              <span>{b.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {draft.modules.routeLibrary && routes.length > 0 && (
                    <div className="glass-inset p-3.5 space-y-2">
                      <p className="text-xs font-semibold text-[var(--text-primary)]">
                        Featured Course Library ({draft.featuredRouteIds.length} / 30)
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {routes.slice(0, 14).map((rt) => {
                          const routeKey = rt.currentPublicationId || rt.id;
                          const picked = draft.featuredRouteIds.includes(routeKey);
                          return (
                            <button
                              key={routeKey}
                              type="button"
                              disabled={!canManage}
                              aria-pressed={picked}
                              onClick={() => toggleIdSelection('featuredRouteIds', routeKey, 30)}
                              className={`min-h-11 px-3 py-1.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 ${
                                picked
                                  ? 'border-red-600 bg-red-700 text-white'
                                  : 'border-[var(--border-control)] bg-[var(--surface-card)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                              }`}
                            >
                              {picked && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                              <span>{rt.raceName} ({rt.distanceLabel})</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {draft.modules.events && races.length > 0 && (
                    <div className="glass-inset p-3.5 space-y-2">
                      <p className="text-xs font-semibold text-[var(--text-primary)]">
                        Linked Official Races ({draft.linkedRaceIds.length} / 30)
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {races.slice(0, 14).map((race) => {
                          const picked = draft.linkedRaceIds.includes(race.id);
                          return (
                            <button
                              key={race.id}
                              type="button"
                              disabled={!canManage}
                              aria-pressed={picked}
                              onClick={() => toggleIdSelection('linkedRaceIds', race.id, 30)}
                              className={`min-h-11 px-3 py-1.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 ${
                                picked
                                  ? 'border-red-600 bg-red-700 text-white'
                                  : 'border-[var(--border-control)] bg-[var(--surface-card)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                              }`}
                            >
                              {picked && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                              <span>{race.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </fieldset>
              </div>

              <div className="border-t border-[var(--border-subtle)] pt-5">
                <fieldset className="space-y-4">
                  <legend className="text-sm font-semibold font-display text-[var(--text-primary)]">
                    Membership & Captains
                  </legend>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label htmlFor={`${baseId}-join-policy`} className="block text-xs font-semibold text-[var(--text-primary)]">
                        Join Policy
                      </label>
                      <Select
                        id={`${baseId}-join-policy`}
                        disabled={!canManage}
                        value={draft.joinPolicy}
                        options={joinPolicyOptions}
                        onChange={(v) => setDraft((prev) => ({ ...prev, joinPolicy: v as ClubJoinPolicy }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor={`${baseId}-member-limit`} className="block text-xs font-semibold text-[var(--text-primary)]">
                        Member Limit (optional)
                      </label>
                      <Input
                        ref={(el) => {
                          fieldRefs.current.memberLimit = el;
                        }}
                        id={`${baseId}-member-limit`}
                        type="number"
                        min={2}
                        max={5000}
                        disabled={!canManage}
                        value={draft.memberLimit}
                        aria-invalid={isFieldErrorShown('memberLimit') ? 'true' : 'false'}
                        aria-describedby={isFieldErrorShown('memberLimit') ? `${baseId}-limit-err` : undefined}
                        onBlur={() => touchField('memberLimit')}
                        onChange={(e) => setDraft((prev) => ({ ...prev, memberLimit: e.target.value }))}
                        placeholder="Unlimited"
                      />
                      {isFieldErrorShown('memberLimit') && (
                        <p id={`${baseId}-limit-err`} className="text-xs font-semibold text-red-700 dark:text-red-400">
                          {fieldErrors.memberLimit}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="glass-inset p-3.5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--text-primary)]">
                        Assigned Captains ({draft.captainUids.length} / 25)
                      </span>
                    </div>

                    {draft.captainUids.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {draft.captainUids.map((capUid) => {
                          const user = usersByUid.get(capUid);
                          return (
                            <span
                              key={capUid}
                              className="inline-flex items-center gap-2 min-h-11 pl-3 pr-1.5 rounded-xl border border-[var(--border-control)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-primary)]"
                            >
                              <Crown className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
                              <span>{user?.displayName || capUid}</span>
                              {canManage && (
                                <button
                                  type="button"
                                  aria-label={`Remove captain ${user?.displayName || capUid}`}
                                  onClick={() => toggleIdSelection('captainUids', capUid, 25)}
                                  className="min-h-11 min-w-11 rounded-lg inline-flex items-center justify-center text-[var(--text-secondary)] hover:text-red-700 dark:hover:text-red-400"
                                >
                                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {canManage && canViewUsers && (
                      <div className="space-y-2">
                        <Input
                          aria-label="Search runners to add as captain"
                          value={captainSearch}
                          onChange={(e) => setCaptainSearch(e.target.value)}
                          placeholder="Search users by name or @username"
                        />
                        {filteredCaptainCandidates.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {filteredCaptainCandidates.map((cand) => (
                              <button
                                key={cand.uid}
                                type="button"
                                onClick={() => toggleIdSelection('captainUids', cand.uid, 25)}
                                className="min-h-11 px-3 py-1.5 rounded-xl border border-[var(--border-control)] bg-[var(--surface-card)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5"
                              >
                                <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>{cand.displayName}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {canManage && !canViewUsers && (
                      <div className="flex items-center gap-2">
                        <Input
                          aria-label="Captain account UID"
                          value={manualCaptainUid}
                          onChange={(e) => setManualCaptainUid(e.target.value)}
                          placeholder="Paste captain UID"
                          className="font-mono"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            const cleaned = manualCaptainUid.trim();
                            if (!VALID_UID_RE.test(cleaned)) return;
                            if (!draft.captainUids.includes(cleaned)) {
                              toggleIdSelection('captainUids', cleaned, 25);
                            }
                            setManualCaptainUid('');
                          }}
                        >
                          Add UID
                        </Button>
                      </div>
                    )}
                  </div>
                </fieldset>
              </div>

              <div className="border-t border-[var(--border-subtle)] pt-5">
                <fieldset className="space-y-4">
                  <legend className="text-sm font-semibold font-display text-[var(--text-primary)]">
                    Visual Branding & Assets
                  </legend>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <HexColorControl
                      id={`${baseId}-primary-color`}
                      label="Primary Color"
                      value={draft.primaryColor}
                      disabled={!canManage}
                      showError={isFieldErrorShown('primaryColor')}
                      errorText={fieldErrors.primaryColor}
                      onBlurTouch={() => touchField('primaryColor')}
                      onChange={(c) => setDraft((prev) => ({ ...prev, primaryColor: c }))}
                      inputRef={(el) => {
                        fieldRefs.current.primaryColor = el;
                      }}
                    />
                    <HexColorControl
                      id={`${baseId}-accent-color`}
                      label="Accent Color"
                      value={draft.accentColor}
                      disabled={!canManage}
                      showError={isFieldErrorShown('accentColor')}
                      errorText={fieldErrors.accentColor}
                      onBlurTouch={() => touchField('accentColor')}
                      onChange={(c) => setDraft((prev) => ({ ...prev, accentColor: c }))}
                      inputRef={(el) => {
                        fieldRefs.current.accentColor = el;
                      }}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="glass-inset p-3.5 space-y-2.5">
                      <span className="block text-xs font-semibold text-[var(--text-primary)]">
                        Club Logo (PNG/JPEG/WebP/AVIF &lt; 8 MB)
                      </span>
                      <input
                        ref={logoFileRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/avif"
                        aria-label="Upload club logo image"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          void handleAssetUpload('logo', file);
                        }}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={!canManage || uploadingKind !== null}
                          onClick={() => logoFileRef.current?.click()}
                        >
                          <Upload className="w-4 h-4" aria-hidden="true" />
                          <span>{uploadingKind === 'logo' ? 'Uploading...' : 'Upload Logo'}</span>
                        </Button>
                        {draft.logoUrl && (
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={!canManage}
                            onClick={() => setDraft((prev) => ({ ...prev, logoUrl: '', logoStoragePath: '' }))}
                          >
                            Clear
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="glass-inset p-3.5 space-y-2.5">
                      <span className="block text-xs font-semibold text-[var(--text-primary)]">
                        Club Cover Banner (Raster &lt; 8 MB)
                      </span>
                      <input
                        ref={coverFileRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/avif"
                        aria-label="Upload club cover banner"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          void handleAssetUpload('cover', file);
                        }}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={!canManage || uploadingKind !== null}
                          onClick={() => coverFileRef.current?.click()}
                        >
                          <Upload className="w-4 h-4" aria-hidden="true" />
                          <span>{uploadingKind === 'cover' ? 'Uploading...' : 'Upload Cover'}</span>
                        </Button>
                        {draft.coverUrl && (
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={!canManage}
                            onClick={() => setDraft((prev) => ({ ...prev, coverUrl: '', coverStoragePath: '' }))}
                          >
                            Clear
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </fieldset>
              </div>

              <div className="border-t border-[var(--border-subtle)] pt-5">
                <fieldset className="space-y-4">
                  <legend className="text-sm font-semibold font-display text-[var(--text-primary)]">
                    Billing & Subscription Metadata
                  </legend>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Admin manual provisioning is active while automated PayMongo per-club subscriptions await approval.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <label htmlFor={`${baseId}-tier`} className="block text-xs font-semibold text-[var(--text-primary)]">
                        Club Plan Tier
                      </label>
                      <Select
                        id={`${baseId}-tier`}
                        disabled={!canManage}
                        value={draft.billingTier}
                        options={billingTierOptions}
                        onChange={(v) => setDraft((prev) => ({ ...prev, billingTier: v as ClubBillingTier }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor={`${baseId}-sub-status`} className="block text-xs font-semibold text-[var(--text-primary)]">
                        Plan Status
                      </label>
                      <Select
                        id={`${baseId}-sub-status`}
                        disabled={!canManage}
                        value={draft.subscriptionStatus}
                        options={subscriptionStatusOptions}
                        onChange={(v) =>
                          setDraft((prev) => ({ ...prev, subscriptionStatus: v as ClubSubscriptionStatus }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor={`${baseId}-billing-prov`} className="block text-xs font-semibold text-[var(--text-primary)]">
                        Billing Provider
                      </label>
                      <Select
                        id={`${baseId}-billing-prov`}
                        disabled={!canManage}
                        value={draft.billingProvider}
                        options={billingProviderOptions}
                        onChange={(v) =>
                          setDraft((prev) => ({ ...prev, billingProvider: v as ClubBillingProvider }))
                        }
                      />
                    </div>
                  </div>

                  {draft.billingProvider === 'paymongo' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label htmlFor={`${baseId}-pm-cust`} className="block text-xs font-semibold text-[var(--text-primary)]">
                          PayMongo Customer ID
                        </label>
                        <Input
                          id={`${baseId}-pm-cust`}
                          disabled={!canManage}
                          value={draft.paymongoCustomerId}
                          onChange={(e) =>
                            setDraft((prev) => ({ ...prev, paymongoCustomerId: e.target.value }))
                          }
                          placeholder="cus_..."
                          className="font-mono"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor={`${baseId}-pm-sub`} className="block text-xs font-semibold text-[var(--text-primary)]">
                          PayMongo Subscription ID
                        </label>
                        <Input
                          id={`${baseId}-pm-sub`}
                          disabled={!canManage}
                          value={draft.paymongoSubscriptionId}
                          onChange={(e) =>
                            setDraft((prev) => ({ ...prev, paymongoSubscriptionId: e.target.value }))
                          }
                          placeholder="sub_..."
                          className="font-mono"
                        />
                      </div>
                    </div>
                  )}
                </fieldset>
              </div>

              {canManage && (
                <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[var(--border-subtle)]">
                  <div className="flex flex-wrap gap-2">
                    {editingClub && (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={isMutating}
                          onClick={() => void handleArchiveToggle()}
                        >
                          {editingClub.status === 'active' ? (
                            <>
                              <Archive className="w-4 h-4" aria-hidden="true" />
                              <span>{archiving ? 'Archiving...' : 'Archive'}</span>
                            </>
                          ) : (
                            <>
                              <RotateCcw className="w-4 h-4" aria-hidden="true" />
                              <span>{archiving ? 'Restoring...' : 'Restore'}</span>
                            </>
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={isMutating}
                          onClick={() => void handleDeleteClub()}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                          <span>{deleting ? 'Deleting...' : 'Delete'}</span>
                        </Button>
                      </>
                    )}
                  </div>

                  <Button type="submit" size="lg" disabled={isMutating} className="min-h-12 bg-red-700 hover:bg-red-600 text-white">
                    <Save className="w-4 h-4" aria-hidden="true" />
                    <span>{saving ? 'Saving Club...' : editingClub ? 'Save Club Changes' : 'Publish Club'}</span>
                  </Button>
                </div>
              )}
            </form>
          </section>

          <aside className="xl:col-span-4 glass-panel p-4 sm:p-5 space-y-4 xl:sticky xl:top-20">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold font-display text-[var(--text-primary)]">
                Live Club Card Preview
              </h3>
              <div className="flex gap-1" role="group" aria-label="Preview backdrop">
                <button
                  type="button"
                  aria-pressed={previewBackdrop === 'light'}
                  onClick={() => setPreviewBackdrop('light')}
                  className={`min-h-11 min-w-11 rounded-xl border inline-flex items-center justify-center ${
                    previewBackdrop === 'light'
                      ? 'border-red-600 bg-red-700 text-white'
                      : 'border-[var(--border-control)] bg-[var(--surface-inset)] text-[var(--text-primary)]'
                  }`}
                  aria-label="Light preview backdrop"
                >
                  <Sun className="w-4 h-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-pressed={previewBackdrop === 'dark'}
                  onClick={() => setPreviewBackdrop('dark')}
                  className={`min-h-11 min-w-11 rounded-xl border inline-flex items-center justify-center ${
                    previewBackdrop === 'dark'
                      ? 'border-red-600 bg-red-700 text-white'
                      : 'border-[var(--border-control)] bg-[var(--surface-inset)] text-[var(--text-primary)]'
                  }`}
                  aria-label="Dark preview backdrop"
                >
                  <Moon className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div
              className={`rounded-2xl border overflow-hidden ${
                previewBackdrop === 'dark'
                  ? 'bg-[#121316] border-white/15 text-zinc-100'
                  : 'bg-[#fcfbfa] border-zinc-200 text-zinc-900'
              }`}
            >
              <div
                className="h-2 w-full"
                style={{
                  background: previewClub.modules.customTheme
                    ? `linear-gradient(90deg, ${previewClub.primaryColor}, ${previewClub.accentColor})`
                    : '#DC2626',
                }}
              />
              {previewClub.coverUrl && (
                <div className="h-28 w-full overflow-hidden border-b border-black/10 dark:border-white/10">
                  <img
                    src={previewClub.coverUrl}
                    alt={`${previewClub.name} cover`}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              <div className="p-4 sm:p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div
                    className="w-12 h-12 rounded-2xl shrink-0 flex items-center justify-center text-base font-semibold text-white overflow-hidden border-2"
                    style={{
                      backgroundColor: previewClub.modules.customTheme ? previewClub.primaryColor : '#DC2626',
                      borderColor: previewClub.modules.customTheme ? previewClub.accentColor : '#F59E0B',
                    }}
                  >
                    {previewClub.logoUrl ? (
                      <img src={previewClub.logoUrl} alt={`${previewClub.name} logo`} className="w-full h-full object-cover" />
                    ) : (
                      previewClub.name.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <h4 className="text-base font-semibold font-display truncate">{previewClub.name}</h4>
                    <p className={`text-xs ${previewBackdrop === 'dark' ? 'text-zinc-300' : 'text-zinc-600'}`}>
                      {previewClub.city} ({previewClub.scheduleSummary})
                    </p>
                  </div>
                </div>

                <p className={`text-sm leading-relaxed ${previewBackdrop === 'dark' ? 'text-zinc-200' : 'text-zinc-700'}`}>
                  {previewClub.description}
                </p>

                <div className="flex flex-wrap gap-1.5">
                  <span
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                      previewBackdrop === 'dark'
                        ? 'border-white/15 bg-white/5 text-zinc-100'
                        : 'border-zinc-300 bg-zinc-100 text-zinc-900'
                    }`}
                  >
                    {CLUB_JOIN_POLICY_META[previewClub.joinPolicy].label}
                  </span>
                  <span
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                      previewBackdrop === 'dark'
                        ? 'border-white/15 bg-white/5 text-zinc-100'
                        : 'border-zinc-300 bg-zinc-100 text-zinc-900'
                    }`}
                  >
                    {CLUB_BILLING_META[previewClub.billingTier].label}
                  </span>
                  <span
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono border ${
                      previewBackdrop === 'dark'
                        ? 'border-white/15 bg-white/5 text-zinc-200'
                        : 'border-zinc-300 bg-zinc-100 text-zinc-800'
                    }`}
                  >
                    {previewClub.memberLimit ? `Cap ${previewClub.memberLimit}` : 'No member cap'}
                  </span>
                </div>

                <div className="pt-3 border-t border-current/10 space-y-2">
                  <p className={`text-xs font-semibold ${previewBackdrop === 'dark' ? 'text-zinc-300' : 'text-zinc-600'}`}>
                    Enabled Modules
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {CLUB_MODULES.filter((k) => previewClub.modules[k]).map((modKey) => (
                      <span
                        key={modKey}
                        className={`px-2 py-0.5 rounded-md text-xs font-semibold ${
                          previewBackdrop === 'dark'
                            ? 'bg-red-500/20 text-red-200'
                            : 'bg-red-50 text-red-800 border border-red-200'
                        }`}
                      >
                        {CLUB_MODULE_META[modKey].label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {subTab === 'requests' && (
        <section
          id={`${baseId}-panel-requests`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-requests`}
          className="glass-panel p-4 sm:p-6 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {(['pending', 'approved', 'rejected'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setRequestFilter(status)}
                  className={`min-h-11 px-4 py-2 rounded-xl text-xs font-semibold capitalize ${
                    requestFilter === status
                      ? 'bg-red-700 text-white'
                      : 'border border-[var(--border-control)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                  }`}
                >
                  {status} ({requests.filter((r) => r.status === status).length})
                </button>
              ))}
            </div>

            {canManage && (
              <div className="w-full sm:w-80">
                <Input
                  aria-label="Review note for applicant"
                  value={requestNote}
                  onChange={(e) => setRequestNote(e.target.value)}
                  placeholder="Optional admin review note"
                />
              </div>
            )}
          </div>

          {!requestsLoaded ? (
            <p role="status" className="text-sm text-[var(--text-secondary)]">
              Loading club applications...
            </p>
          ) : visibleRequests.length === 0 ? (
            <div className="glass-inset p-6 text-center space-y-1">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                No {requestFilter} club requests
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Runner club creation requests submitted from Explore appear here for admin provisioning.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {visibleRequests.map((req) => (
                <article
                  key={req.requestId}
                  className="glass-inset p-4 sm:p-5 space-y-3 border border-[var(--border-default)] rounded-2xl"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <h3 className="text-base font-semibold font-display text-[var(--text-primary)] truncate">
                        {req.clubName}
                      </h3>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {req.city} ({req.scheduleSummary})
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-primary)] shrink-0 capitalize">
                      {req.status}
                    </span>
                  </div>

                  {req.notes && (
                    <p className="text-sm text-[var(--text-secondary)]">{req.notes}</p>
                  )}

                  <div className="text-xs text-[var(--text-secondary)] space-y-1">
                    <p className="font-mono">
                      Requester UID: {req.requesterUid}
                      {req.contactHandle ? ` | Handle: ${req.contactHandle}` : ''}
                    </p>
                    <p>
                      Desired modules:{' '}
                      {CLUB_MODULES.filter((k) => req.desiredModules?.[k])
                        .map((k) => CLUB_MODULE_META[k].label)
                        .join(', ')}
                    </p>
                  </div>

                  {req.status === 'pending' && canManage && (
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--border-subtle)]">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={resolvingRequestId !== null}
                        onClick={() => {
                          setEditingClubId(null);
                          setIdManuallyEdited(true);
                          setDraft(clubRequestToDraft(req));
                          setSubTab('studio');
                        }}
                      >
                        Customize in Studio
                      </Button>
                      <Button
                        type="button"
                        disabled={resolvingRequestId !== null}
                        onClick={() => void handleResolveRequest(req, 'approved')}
                        className="bg-red-700 hover:bg-red-600 text-white"
                      >
                        {resolvingRequestId === req.requestId ? 'Approving...' : 'Approve & Create'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={resolvingRequestId !== null}
                        onClick={() => void handleResolveRequest(req, 'rejected')}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {subTab === 'members' && (
        <section
          id={`${baseId}-panel-members`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-members`}
          className="glass-panel p-4 sm:p-6 space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div className="space-y-1.5">
              <label htmlFor={`${baseId}-roster-club`} className="block text-xs font-semibold text-[var(--text-primary)]">
                Select Club Roster
              </label>
              <Select
                id={`${baseId}-roster-club`}
                value={effectiveRosterClubId}
                options={clubSelectOptions}
                onChange={setSelectedRosterClubId}
                placeholder="Choose a club"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${baseId}-roster-search`} className="block text-xs font-semibold text-[var(--text-primary)]">
                Filter Members
              </label>
              <Input
                id={`${baseId}-roster-search`}
                type="search"
                value={rosterSearch}
                onChange={(e) => setRosterSearch(e.target.value)}
                placeholder="Search by name, @username, or role"
              />
            </div>
          </div>

          {!rosterLoaded ? (
            <p role="status" className="text-sm text-[var(--text-secondary)]">
              Loading club roster...
            </p>
          ) : filteredRoster.length === 0 ? (
            <div className="glass-inset p-6 text-center space-y-1">
              <Users className="w-6 h-6 mx-auto text-[var(--text-secondary)]" aria-hidden="true" />
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                No matching club members
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-default)] rounded-2xl overflow-hidden">
              {filteredRoster.map((member) => (
                <div
                  key={member.id}
                  className="p-4 bg-[var(--surface-inset)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">
                        {member.displayName || member.uid}
                      </p>
                      <span
                        className={`px-2 py-0.5 rounded-md text-xs font-semibold border ${
                          member.status === 'active'
                            ? 'border-emerald-600/35 bg-emerald-50 text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-950/70 dark:text-emerald-200'
                            : 'border-amber-600/35 bg-amber-50 text-amber-900 dark:border-amber-400/40 dark:bg-amber-950/70 dark:text-amber-200'
                        }`}
                      >
                        {member.status}
                      </span>
                      {member.role === 'captain' && (
                        <span className="px-2 py-0.5 rounded-md text-xs font-semibold border border-amber-600/35 bg-amber-50 text-amber-900 dark:border-amber-400/40 dark:bg-amber-950/70 dark:text-amber-200 inline-flex items-center gap-1">
                          <Crown className="w-3 h-3" aria-hidden="true" /> Captain
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-mono text-[var(--text-secondary)]">
                      {member.username ? `@${member.username} | ` : ''}{member.uid}
                    </p>
                  </div>

                  {canManage && (
                    <div className="flex flex-wrap gap-2 shrink-0">
                      {member.status === 'pending' && (
                        <>
                          <Button
                            type="button"
                            disabled={memberActionUid !== null}
                            onClick={() => void handleRosterAction(member, 'approve')}
                            className="bg-red-700 hover:bg-red-600 text-white"
                          >
                            Approve
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={memberActionUid !== null}
                            onClick={() => void handleRosterAction(member, 'reject')}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                      {member.status === 'active' && (
                        <>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={memberActionUid !== null}
                            onClick={() =>
                              void handleRosterAction(
                                member,
                                member.role === 'captain' ? 'demote_captain' : 'promote_captain',
                              )
                            }
                          >
                            {member.role === 'captain' ? 'Demote Captain' : 'Make Captain'}
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            disabled={memberActionUid !== null}
                            onClick={() => void handleRosterAction(member, 'remove')}
                          >
                            <UserMinus className="w-4 h-4" aria-hidden="true" />
                            <span>Remove</span>
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
