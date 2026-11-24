import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  Archive,
  Award,
  Eye,
  EyeOff,
  Moon,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { db } from '../../firebase';
import { useAccess } from '../../lib/access';
import {
  archiveBadgeDefinition,
  deleteBadgeDefinition,
  saveBadgeDefinition,
  seedDefaultBadges,
  subscribeBadgeCatalog,
  uploadBadgeArtwork,
  validateBadgeAssetUploadFile,
} from '../../lib/badges/client';
import {
  E2E_BADGES_KEY,
  E2E_RACES_KEY,
  E2E_USERS_KEY,
  archiveDevBadgeFixture,
  deleteDevBadgeFixture,
  readDevSessionJson,
  saveDevBadgeFixture,
  seedDevBadgesFixture,
  uploadDevBadgeArtworkFixture,
  writeDevSessionJson,
} from '../../lib/badges/e2eFixtures';
import {
  BADGE_ANIMATION_EFFECTS,
  BADGE_ANIMATION_META,
  BADGE_BORDER_META,
  BADGE_BORDER_STYLES,
  BADGE_CATEGORIES,
  BADGE_CATEGORY_META,
  BADGE_EMBLEM_PRESETS,
  BADGE_TIERS,
  BADGE_TIER_META,
  formatBadgeRuleSummary,
  sanitizeHexColor,
} from '../../lib/badges/presets';
import {
  BADGE_STUDIO_COLOR_SWATCHES,
  badgeDefinitionToDraft,
  createBlankBadgeDraft,
  draftToPreviewBadge,
  slugifyBadgeId,
  validateAndBuildSavePayload,
  type BadgeFormDraft,
} from '../../lib/badges/studioDraft';
import type {
  BadgeAnimationEffect,
  BadgeBorderStyle,
  BadgeCategory,
  BadgeDefinition,
  BadgeTier,
} from '../../lib/badges/types';
import { subscribeSharedRaces } from '../../lib/racesStore';
import type { Race, UserProfile } from '../../types';
import BadgeArtwork from '../badges/BadgeArtwork';
import { useFeedback } from '../ui/FeedbackProvider';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, type SelectOption } from '../ui/Select';
import { BadgeRuleFields } from './BadgeRuleFields';
import { ManualGrantTab, RetroactiveSyncTab } from './BadgeStudioOperations';

type StudioSubTab = 'designer' | 'grant' | 'retroactive';

interface BadgeStudioPanelProps {
  profile: UserProfile;
}

function ColorControl({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (nextColor: string) => void;
}) {
  const safeHex = sanitizeHexColor(value, '#DC2626');
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs font-semibold text-[var(--text-primary)]">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} color picker`}
          disabled={disabled}
          value={safeHex}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="w-11 h-11 p-1 rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] cursor-pointer shrink-0 disabled:opacity-50"
        />
        <Input
          id={id}
          value={value}
          maxLength={7}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onChange(sanitizeHexColor(value, safeHex))}
          placeholder="#DC2626"
          className="font-mono uppercase"
        />
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label={`${label} quick swatches`}>
        {BADGE_STUDIO_COLOR_SWATCHES.map((swatch) => {
          const isSelected = safeHex === swatch.toUpperCase();
          return (
            <button
              key={swatch}
              type="button"
              disabled={disabled}
              aria-label={`Use ${swatch} for ${label}`}
              aria-pressed={isSelected}
              onClick={() => onChange(swatch)}
              className={`min-h-11 min-w-11 rounded-xl border flex items-center justify-center transition-colors ${
                isSelected
                  ? 'border-red-600 dark:border-red-400 bg-red-500/10'
                  : 'border-[var(--border-default)] bg-[var(--surface-inset)] hover:border-[var(--border-strong)]'
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

export default function BadgeStudioPanel({ profile }: BadgeStudioPanelProps) {
  const { can, authority: isSuperAdmin } = useAccess();
  const { confirm, notify } = useFeedback();

  const canView = isSuperAdmin || can('badges.view');
  const canManage = isSuperAdmin || can('badges.manage');
  const canGrant = isSuperAdmin || can('badges.grant');
  const canViewUsers = isSuperAdmin || can('users.view');
  const isE2eFixtureMode = import.meta.env.DEV && profile.uid.startsWith('e2e-');

  const baseId = useId();
  const mountedRef = useRef(true);
  const selectionEpochRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [subTab, setSubTab] = useState<StudioSubTab>('designer');
  const [badges, setBadges] = useState<BadgeDefinition[]>([]);
  const [badgesLoaded, setBadgesLoaded] = useState(false);
  const [badgesError, setBadgesError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [races, setRaces] = useState<Race[]>([]);

  const [catalogSearch, setCatalogSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<string>('all');

  const [editingBadgeId, setEditingBadgeId] = useState<string | null>(null);
  const [idManuallyEdited, setIdManuallyEdited] = useState(false);
  const [draft, setDraft] = useState<BadgeFormDraft>(() => createBlankBadgeDraft(10));

  const [previewBackdrop, setPreviewBackdrop] = useState<'dark' | 'light'>('dark');
  const [previewMystery, setPreviewMystery] = useState(false);
  const [showToastPreview, setShowToastPreview] = useState(false);

  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [uploadingArtwork, setUploadingArtwork] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const isFormMutating = saving || uploadingArtwork || archiving || deleting;

  useEffect(() => {
    if (!canView) return;
    if (import.meta.env.DEV && isE2eFixtureMode) {
      const fixtureBadges = readDevSessionJson<BadgeDefinition>(E2E_BADGES_KEY) ?? [];
      setBadges(fixtureBadges);
      setBadgesLoaded(true);
      setBadgesError(null);
      return;
    }

    setBadgesLoaded(false);
    return subscribeBadgeCatalog(
      (snap) => {
        setBadges(snap.badges);
        setBadgesLoaded(snap.loaded);
        setBadgesError(snap.error);
      },
      { includeArchived },
    );
  }, [canView, includeArchived, isE2eFixtureMode]);

  useEffect(() => {
    if (!canManage && editingBadgeId === null && badges.length > 0) {
      selectionEpochRef.current += 1;
      setEditingBadgeId(badges[0].badgeId);
      setIdManuallyEdited(true);
      setDraft(badgeDefinitionToDraft(badges[0]));
    }
  }, [badges, canManage, editingBadgeId]);

  const availableTabs = useMemo(() => {
    const items: Array<{ id: StudioSubTab; label: string }> = [
      { id: 'designer', label: 'Catalog & Designer' },
    ];
    if (canGrant) items.push({ id: 'grant', label: 'Manual Grant' });
    if (canManage) items.push({ id: 'retroactive', label: 'Retroactive Sync' });
    return items;
  }, [canGrant, canManage]);

  const activeTab: StudioSubTab = availableTabs.some((t) => t.id === subTab)
    ? subTab
    : 'designer';

  useEffect(() => {
    if (!canView || !canGrant || activeTab !== 'grant') {
      setUsers([]);
      setUsersError(null);
      setUsersLoaded(true);
      return;
    }
    if (import.meta.env.DEV && isE2eFixtureMode) {
      const fixtureUsers = readDevSessionJson<UserProfile>(E2E_USERS_KEY) ?? [];
      setUsers(fixtureUsers);
      setUsersLoaded(true);
      setUsersError(null);
      return;
    }
    if (!canViewUsers) {
      setUsers([]);
      setUsersError(null);
      setUsersLoaded(true);
      return;
    }

    setUsersLoaded(false);
    setUsersError(null);
    return onSnapshot(
      collection(db, 'users'),
      (snap) => {
        setUsers(snap.docs.map((item) => item.data() as UserProfile));
        setUsersLoaded(true);
        setUsersError(null);
      },
      (err) => {
        setUsersError(err.message || 'Unable to load runner accounts.');
        setUsersLoaded(true);
      },
    );
  }, [activeTab, canGrant, canView, canViewUsers, isE2eFixtureMode]);

  useEffect(() => {
    if (!canView) return;
    if (import.meta.env.DEV && isE2eFixtureMode) {
      const fixtureRaces = readDevSessionJson<Race>(E2E_RACES_KEY) ?? [];
      setRaces(fixtureRaces);
      return;
    }
    return subscribeSharedRaces((list, loaded) => {
      if (loaded) setRaces(list);
    });
  }, [canView, isE2eFixtureMode]);

  const visibleBadges = useMemo(() => {
    const term = catalogSearch.trim().toLowerCase();
    return badges.filter((badge) => {
      if (!includeArchived && badge.status === 'archived') return false;
      if (tierFilter !== 'all' && badge.tier !== tierFilter) return false;
      if (!term) return true;
      const haystack = `${badge.name} ${badge.badgeId} ${badge.category} ${badge.description}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [badges, catalogSearch, includeArchived, tierFilter]);

  const previewBadge = useMemo(() => draftToPreviewBadge(draft), [draft]);

  const tierOptions: SelectOption[] = useMemo(
    () =>
      BADGE_TIERS.map((tierId) => {
        const meta = BADGE_TIER_META[tierId];
        return {
          value: tierId,
          label: meta.label,
          accentDot: meta.defaultPrimary,
        };
      }),
    [],
  );

  const tierFilterOptions: SelectOption[] = useMemo(
    () => [{ value: 'all', label: 'All tiers' }, ...tierOptions],
    [tierOptions],
  );

  const categoryOptions: SelectOption[] = useMemo(
    () =>
      BADGE_CATEGORIES.map((catId) => ({
        value: catId,
        label: BADGE_CATEGORY_META[catId].label,
        sublabel: BADGE_CATEGORY_META[catId].description,
      })),
    [],
  );

  const borderOptions: SelectOption[] = useMemo(
    () =>
      BADGE_BORDER_STYLES.map((borderId) => ({
        value: borderId,
        label: BADGE_BORDER_META[borderId].label,
        sublabel: BADGE_BORDER_META[borderId].summary,
      })),
    [],
  );

  const animationOptions: SelectOption[] = useMemo(
    () =>
      BADGE_ANIMATION_EFFECTS.map((animId) => ({
        value: animId,
        label: BADGE_ANIMATION_META[animId].label,
        sublabel: BADGE_ANIMATION_META[animId].summary,
      })),
    [],
  );

  const patchDraft = (patch: Partial<BadgeFormDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setFormError(null);
  };

  const resetToNewDraft = () => {
    selectionEpochRef.current += 1;
    const maxSort = badges.reduce((max, b) => Math.max(max, b.sortOrder ?? 0), 0);
    setEditingBadgeId(null);
    setIdManuallyEdited(false);
    setDraft(createBlankBadgeDraft(maxSort + 10));
    setFormError(null);
  };

  const handleCreateNew = () => {
    if (isFormMutating) return;
    resetToNewDraft();
  };

  const handleSelectBadge = (badge: BadgeDefinition) => {
    if (isFormMutating) return;
    selectionEpochRef.current += 1;
    setEditingBadgeId(badge.badgeId);
    setIdManuallyEdited(true);
    setDraft(badgeDefinitionToDraft(badge));
    setFormError(null);
  };

  const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    if (availableTabs.length <= 1) return;
    let nextIndex = -1;
    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % availableTabs.length;
    else if (e.key === 'ArrowLeft')
      nextIndex = (currentIndex - 1 + availableTabs.length) % availableTabs.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = availableTabs.length - 1;
    if (nextIndex < 0) return;

    e.preventDefault();
    const nextTab = availableTabs[nextIndex];
    setSubTab(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  };

  const handleSeedDefaults = async () => {
    if (!canManage || seeding) return;
    const opEpoch = selectionEpochRef.current;
    setSeeding(true);
    try {
      const res =
        import.meta.env.DEV && isE2eFixtureMode
          ? (() => {
              const seeded = seedDevBadgesFixture(badges, profile.uid);
              writeDevSessionJson(E2E_BADGES_KEY, seeded.catalog);
              setBadges(seeded.catalog);
              return seeded;
            })()
          : await seedDefaultBadges();
      if (!mountedRef.current || selectionEpochRef.current !== opEpoch) return;
      notify({
        tone: 'success',
        title: res.seededCount > 0 ? 'Starter pack seeded' : 'Starter pack up to date',
        message:
          res.seededCount > 0
            ? `Added ${res.seededCount} Philippine starter badge${res.seededCount === 1 ? '' : 's'}.`
            : 'All 8 starter pack badges are already present in the catalog.',
      });
    } catch (err) {
      if (!mountedRef.current || selectionEpochRef.current !== opEpoch) return;
      notify({
        tone: 'error',
        title: 'Could not seed starter pack',
        message: err instanceof Error && err.message ? err.message : 'Please try again.',
      });
    } finally {
      if (mountedRef.current) {
        setSeeding(false);
      }
    }
  };

  const handleFileChange = async (file: File | undefined) => {
    if (!file || !canManage || isFormMutating) return;
    const check = validateBadgeAssetUploadFile(file);
    if (!check.ok) {
      setFormError(check.error);
      return;
    }
    const targetBadgeId = (editingBadgeId || draft.badgeId).trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(targetBadgeId)) {
      setFormError('Enter a valid Badge ID before uploading custom artwork.');
      return;
    }

    const opEpoch = selectionEpochRef.current;
    setFormError(null);
    setUploadingArtwork(true);
    try {
      const uploaded =
        import.meta.env.DEV && isE2eFixtureMode
          ? uploadDevBadgeArtworkFixture(profile.uid, targetBadgeId, file)
          : await uploadBadgeArtwork(profile.uid, targetBadgeId, file);
      if (!mountedRef.current || selectionEpochRef.current !== opEpoch) return;
      patchDraft({
        artworkType: 'upload',
        artworkUrl: uploaded.artworkUrl,
        artworkStoragePath: uploaded.artworkStoragePath,
      });
      notify({
        tone: 'success',
        title: 'Artwork uploaded',
        message: 'Save the badge definition to publish the updated artwork.',
      });
    } catch (err) {
      if (!mountedRef.current || selectionEpochRef.current !== opEpoch) return;
      setFormError(
        err instanceof Error && err.message ? err.message : 'Unable to upload badge artwork.',
      );
    } finally {
      if (mountedRef.current) {
        setUploadingArtwork(false);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!canManage || isFormMutating) return;

    const candidateDraft: BadgeFormDraft = editingBadgeId
      ? { ...draft, badgeId: editingBadgeId }
      : draft;
    const validated = validateAndBuildSavePayload(candidateDraft);
    if (!validated.ok) {
      setFormError(validated.error);
      return;
    }

    const opEpoch = selectionEpochRef.current;
    setFormError(null);
    setSaving(true);
    try {
      const saved =
        import.meta.env.DEV && isE2eFixtureMode
          ? (() => {
              const res = saveDevBadgeFixture(badges, validated.payload, profile.uid);
              writeDevSessionJson(E2E_BADGES_KEY, res.catalog);
              setBadges(res.catalog);
              return res.saved;
            })()
          : await saveBadgeDefinition(validated.payload);
      if (!mountedRef.current || selectionEpochRef.current !== opEpoch) return;
      selectionEpochRef.current += 1;
      setEditingBadgeId(saved.badgeId);
      setIdManuallyEdited(true);
      setDraft(badgeDefinitionToDraft(saved));
      notify({
        tone: 'success',
        title: 'Badge saved',
        message: `${saved.name} is now ${saved.status === 'archived' ? 'saved (archived)' : 'live in the catalog'}.`,
      });
    } catch (err) {
      if (!mountedRef.current || selectionEpochRef.current !== opEpoch) return;
      setFormError(
        err instanceof Error && err.message ? err.message : 'Unable to save badge.',
      );
    } finally {
      if (mountedRef.current) {
        setSaving(false);
      }
    }
  };

  const handleToggleArchive = async () => {
    if (!canManage || !editingBadgeId || isFormMutating) return;
    const targetBadgeId = editingBadgeId;
    const nextStatus = draft.status === 'archived' ? 'active' : 'archived';
    const opEpoch = selectionEpochRef.current;
    setArchiving(true);
    setFormError(null);
    try {
      const updated =
        import.meta.env.DEV && isE2eFixtureMode
          ? (() => {
              const res = archiveDevBadgeFixture(badges, targetBadgeId, nextStatus, profile.uid);
              writeDevSessionJson(E2E_BADGES_KEY, res.catalog);
              setBadges(res.catalog);
              return res.updated;
            })()
          : await archiveBadgeDefinition(targetBadgeId, nextStatus);
      if (!mountedRef.current || selectionEpochRef.current !== opEpoch) return;
      setDraft(badgeDefinitionToDraft(updated));
      notify({
        tone: 'success',
        title: nextStatus === 'archived' ? 'Badge archived' : 'Badge restored',
        message: `${updated.name} is now ${nextStatus}.`,
      });
    } catch (err) {
      if (!mountedRef.current || selectionEpochRef.current !== opEpoch) return;
      setFormError(
        err instanceof Error && err.message ? err.message : 'Could not update badge status.',
      );
    } finally {
      if (mountedRef.current) {
        setArchiving(false);
      }
    }
  };

  const handleDelete = async () => {
    if (!canManage || !editingBadgeId || isFormMutating) return;
    const targetBadgeId = editingBadgeId;
    const targetName = draft.name.trim() || targetBadgeId;
    const opEpoch = selectionEpochRef.current;
    const confirmed = await confirm({
      title: `Delete "${targetName}"?`,
      message:
        'Deleting removes this badge definition and cleans up its custom Storage artwork. Existing runner award records keep their earned snapshot.',
      confirmLabel: 'Delete badge',
      cancelLabel: 'Keep badge',
      destructive: true,
    });
    if (!confirmed || !mountedRef.current || selectionEpochRef.current !== opEpoch) return;

    setDeleting(true);
    setFormError(null);
    try {
      if (import.meta.env.DEV && isE2eFixtureMode) {
        const nextCatalog = deleteDevBadgeFixture(badges, targetBadgeId);
        writeDevSessionJson(E2E_BADGES_KEY, nextCatalog);
        setBadges(nextCatalog);
      } else {
        await deleteBadgeDefinition(targetBadgeId);
      }
      if (!mountedRef.current || selectionEpochRef.current !== opEpoch) return;
      notify({
        tone: 'success',
        title: 'Badge deleted',
        message: `${targetName} was removed from the catalog.`,
      });
      resetToNewDraft();
    } catch (err) {
      if (!mountedRef.current || selectionEpochRef.current !== opEpoch) return;
      setFormError(
        err instanceof Error && err.message ? err.message : 'Could not delete badge.',
      );
    } finally {
      if (mountedRef.current) {
        setDeleting(false);
      }
    }
  };

  if (!canView) {
    return (
      <div className="w-full max-w-[1600px] mx-auto">
        <div className="glass-panel p-6 sm:p-8 flex items-start gap-4">
          <ShieldAlert className="w-6 h-6 text-red-700 dark:text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <h2 className="text-lg font-semibold font-display text-[var(--text-primary)]">
              Badge Studio access required
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              Your account does not have permission to view or manage platform badges. Ask a Super Admin to grant the badges.view capability if needed.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const editingBadge = editingBadgeId
    ? badges.find((b) => b.badgeId === editingBadgeId) || null
    : null;
  const effectiveTierLabel =
    previewBadge.customTierLabel?.trim() || BADGE_TIER_META[previewBadge.tier]?.label || previewBadge.tier;

  return (
    <div className="w-full max-w-[1600px] mx-auto space-y-6">
      <header className="glass-panel p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h2 className="text-xl sm:text-2xl font-semibold font-display text-[var(--text-primary)] tracking-tight">
              Badge Studio
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              Design custom badges, configure achievement rules, issue manual grants, and run retroactive sync.
            </p>
          </div>

          {canManage && (
            <Button
              type="button"
              variant="secondary"
              disabled={seeding}
              onClick={() => void handleSeedDefaults()}
              className="min-h-11 shrink-0"
            >
              <Sparkles className="w-4 h-4 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
              <span>{seeding ? 'Seeding Pack...' : 'Seed Starter Pack'}</span>
            </Button>
          )}
        </div>

        <div
          role="tablist"
          aria-label="Badge Studio sections"
          className="flex flex-wrap gap-2 pt-2 border-t border-[var(--border-subtle)]"
        >
          {availableTabs.map((item, idx) => {
            const isSelected = activeTab === item.id;
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
                className={`min-h-11 px-4 py-2 rounded-xl text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 ${
                  isSelected
                    ? 'bg-red-700 text-white'
                    : 'border border-[var(--border-control)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {!canManage && (
          <p className="text-xs text-[var(--text-secondary)]">
            Read-only catalog mode: badge editing and archival require the badges.manage permission.
          </p>
        )}
      </header>

      {activeTab === 'designer' && (
        <div
          id={`${baseId}-panel-designer`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-designer`}
          className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start"
        >
          <aside className="xl:col-span-3 glass-panel p-4 sm:p-5 space-y-4 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:flex xl:flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
              <h3 className="text-base font-semibold font-display text-[var(--text-primary)]">
                Catalog ({badges.length})
              </h3>
              {canManage && (
                <Button
                  type="button"
                  size="sm"
                  disabled={isFormMutating}
                  onClick={handleCreateNew}
                  className="min-h-11 bg-red-700 hover:bg-red-600 text-white"
                >
                  <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Create New Badge</span>
                </Button>
              )}
            </div>

            <search className="space-y-2.5 shrink-0">
              <div className="relative">
                <label htmlFor={`${baseId}-catalog-search`} className="sr-only">
                  Search badges
                </label>
                <Search
                  className="w-4 h-4 text-[var(--text-secondary)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <Input
                  id={`${baseId}-catalog-search`}
                  type="search"
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder="Search badges"
                  className="pl-10"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2.5">
                <div>
                  <label htmlFor={`${baseId}-tier-filter`} className="sr-only">
                    Filter catalog by tier
                  </label>
                  <Select
                    id={`${baseId}-tier-filter`}
                    aria-label="Filter catalog by tier"
                    value={tierFilter}
                    options={tierFilterOptions}
                    onChange={setTierFilter}
                  />
                </div>

                <label
                  htmlFor={`${baseId}-show-archived`}
                  className="min-h-11 flex items-center justify-between gap-3 px-3 rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] cursor-pointer"
                >
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    Show archived
                  </span>
                  <input
                    id={`${baseId}-show-archived`}
                    type="checkbox"
                    role="switch"
                    checked={includeArchived}
                    onChange={(e) => setIncludeArchived(e.target.checked)}
                    className="access-switch"
                  />
                </label>
              </div>
            </search>

            {badgesError && (
              <div
                role="alert"
                className="rounded-xl border border-red-600/40 bg-red-500/10 px-3 py-2.5 text-xs font-semibold text-red-700 dark:text-red-300"
              >
                {badgesError}
              </div>
            )}

            {!badgesLoaded ? (
              <p role="status" className="text-xs text-[var(--text-secondary)] py-4">
                Loading badge catalog...
              </p>
            ) : visibleBadges.length === 0 ? (
              <div className="glass-inset p-5 text-center space-y-2.5">
                <Award className="w-6 h-6 mx-auto text-[var(--text-secondary)]" aria-hidden="true" />
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {badges.length === 0 ? 'Catalog is empty' : 'No matching badges'}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {badges.length === 0
                    ? 'Seed the 8-badge starter pack or design a custom badge.'
                    : 'Adjust your search term, tier filter, or archived toggle.'}
                </p>
                {badges.length > 0 && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setCatalogSearch('');
                      setTierFilter('all');
                    }}
                    className="min-h-11"
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2 max-h-[34rem] xl:flex-1 xl:min-h-0 xl:max-h-none overflow-y-auto pr-1">
                {visibleBadges.map((item) => {
                  const selected = editingBadgeId === item.badgeId;
                  const itemTierLabel =
                    item.customTierLabel?.trim() || BADGE_TIER_META[item.tier]?.label || item.tier;
                  const itemCategoryLabel =
                    BADGE_CATEGORY_META[item.category]?.label ?? item.category;
                  return (
                    <button
                      key={item.badgeId}
                      type="button"
                      disabled={isFormMutating}
                      onClick={() => handleSelectBadge(item)}
                      aria-current={selected ? 'true' : undefined}
                      className={`w-full min-h-11 p-3 rounded-xl border text-left flex items-center gap-3 transition-colors disabled:opacity-60 ${
                        selected
                          ? 'border-red-600 dark:border-red-400 bg-red-500/10'
                          : 'border-[var(--border-control)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)]'
                      }`}
                    >
                      <BadgeArtwork
                        badge={item}
                        size="sm"
                        locked={item.status === 'archived'}
                      />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                          {item.name}
                        </p>
                        <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
                          <span className="truncate">
                            {itemTierLabel} ({itemCategoryLabel})
                          </span>
                          <span className="font-mono font-semibold shrink-0">
                            +{item.xpReward} XP
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-secondary)] truncate">
                          {formatBadgeRuleSummary(item.rule)}
                        </p>
                      </div>
                      {item.status === 'archived' && (
                        <span className="px-2 py-0.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-secondary)] shrink-0">
                          Archived
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          <section
            aria-labelledby={`${baseId}-preview-heading`}
            className="xl:col-span-4 glass-panel p-4 sm:p-5 space-y-4 xl:sticky xl:top-20"
          >
            <div className="space-y-3">
              <h3
                id={`${baseId}-preview-heading`}
                className="text-base font-semibold font-display text-[var(--text-primary)]"
              >
                Live Crest Preview
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-pressed={previewBackdrop === 'light'}
                  onClick={() =>
                    setPreviewBackdrop((prev) => (prev === 'dark' ? 'light' : 'dark'))
                  }
                  className="min-h-11 px-3 rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] inline-flex items-center gap-1.5"
                >
                  {previewBackdrop === 'dark' ? (
                    <Sun className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <Moon className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>{previewBackdrop === 'dark' ? 'Dark Stage' : 'Light Stage'}</span>
                </button>

                <button
                  type="button"
                  aria-pressed={previewMystery}
                  onClick={() => setPreviewMystery((prev) => !prev)}
                  className="min-h-11 px-3 rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] inline-flex items-center gap-1.5"
                >
                  {previewMystery ? (
                    <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>{previewMystery ? 'Mystery Locked' : 'Unlocked'}</span>
                </button>

                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowToastPreview((prev) => !prev)}
                  className="min-h-11"
                >
                  <span>{showToastPreview ? 'Hide Toast Preview' : 'Preview Toast'}</span>
                </Button>
              </div>
            </div>

            <div
              className={`rounded-2xl border p-5 flex flex-col sm:flex-row xl:flex-col items-center gap-5 transition-colors ${
                previewBackdrop === 'dark'
                  ? 'bg-[#14161D] border-white/15 text-zinc-100'
                  : 'bg-[#F6F6F3] border-zinc-300 text-zinc-900'
              }`}
            >
              <BadgeArtwork
                badge={previewBadge}
                size="xl"
                locked={previewMystery}
                mystery={previewMystery}
              />

              <div className="min-w-0 w-full flex-1 text-center sm:text-left xl:text-center space-y-2">
                <div className="flex flex-wrap items-center justify-center sm:justify-start xl:justify-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold ${
                      previewBackdrop === 'dark'
                        ? 'border-white/20 bg-white/10 text-white'
                        : 'border-zinc-300 bg-white text-zinc-900'
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{
                        backgroundColor: previewMystery
                          ? '#71717A'
                          : previewBadge.primaryColor,
                      }}
                      aria-hidden="true"
                    />
                    {previewMystery ? 'Secret' : effectiveTierLabel}
                  </span>
                  <span
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold ${
                      previewBackdrop === 'dark'
                        ? 'bg-red-500/20 text-red-200 border border-red-400/35'
                        : 'bg-red-100 text-red-800 border border-red-300'
                    }`}
                  >
                    +{previewBadge.xpReward} XP
                  </span>
                  <span
                    className={`text-xs ${
                      previewBackdrop === 'dark' ? 'text-zinc-300' : 'text-zinc-600'
                    }`}
                  >
                    {BADGE_CATEGORY_META[previewBadge.category]?.label ?? previewBadge.category}
                  </span>
                </div>

                <p className="text-lg font-semibold font-display break-words">
                  {previewMystery ? 'Mystery Achievement' : previewBadge.name}
                </p>
                <p
                  className={`text-sm break-words ${
                    previewBackdrop === 'dark' ? 'text-zinc-300' : 'text-zinc-700'
                  }`}
                >
                  {previewMystery
                    ? 'Keep running to reveal this hidden badge.'
                    : previewBadge.description}
                </p>
                <p
                  className={`text-xs font-mono break-words ${
                    previewBackdrop === 'dark' ? 'text-zinc-400' : 'text-zinc-600'
                  }`}
                >
                  Unlock: {formatBadgeRuleSummary(previewBadge.rule)}
                </p>
              </div>
            </div>

            {showToastPreview && (
              <div
                role="status"
                aria-label="Achievement toast preview"
                className="rounded-2xl border border-red-600/40 bg-[var(--surface-card)] p-4 shadow-md flex items-center gap-3"
              >
                <BadgeArtwork badge={previewBadge} size="md" />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-xs font-semibold text-red-700 dark:text-red-400">
                    Achievement Unlocked ({effectiveTierLabel})
                  </p>
                  <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {previewBadge.name}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    +{previewBadge.xpReward} XP earned
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close toast preview"
                  onClick={() => setShowToastPreview(false)}
                  className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            )}
          </section>

          <form
            onSubmit={(e) => void handleSave(e)}
            noValidate
            aria-labelledby={`${baseId}-form-heading`}
            className="xl:col-span-5 glass-panel p-4 sm:p-6 space-y-6"
          >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--border-subtle)]">
                <div>
                  <h3
                    id={`${baseId}-form-heading`}
                    className="text-base font-semibold font-display text-[var(--text-primary)]"
                  >
                    {editingBadgeId ? `Editing: ${editingBadgeId}` : 'New Custom Badge'}
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    {editingBadge
                      ? `Last updated ${editingBadge.updatedAt.slice(0, 10)} by ${editingBadge.updatedBy}`
                      : 'Configure identity, artwork, frame, motion, XP, and unlock rule.'}
                  </p>
                </div>
                {editingBadgeId && (
                  <span
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                      draft.status === 'archived'
                        ? 'border-[var(--border-control)] bg-[var(--surface-inset)] text-[var(--text-secondary)]'
                        : 'border-emerald-600/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                    }`}
                  >
                    {draft.status === 'archived' ? 'Archived' : 'Active'}
                  </span>
                )}
              </div>

              <fieldset className="space-y-4 border-0 p-0 m-0">
                <legend className="text-sm font-semibold font-display text-[var(--text-primary)]">
                  Identity & Classification
                </legend>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label
                      htmlFor={`${baseId}-name`}
                      className="block text-xs font-semibold text-[var(--text-primary)]"
                    >
                      Badge Name (1 to 80 characters)
                    </label>
                    <Input
                      id={`${baseId}-name`}
                      value={draft.name}
                      maxLength={80}
                      disabled={!canManage}
                      required
                      onChange={(e) => {
                        const nextName = e.target.value;
                        patchDraft({
                          name: nextName,
                          ...(!editingBadgeId && !idManuallyEdited
                            ? { badgeId: slugifyBadgeId(nextName) }
                            : {}),
                        });
                      }}
                      placeholder="e.g. Dawn Patrol PH"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor={`${baseId}-badgeId`}
                      className="block text-xs font-semibold text-[var(--text-primary)]"
                    >
                      Badge ID (a-z, 0-9, underscore, hyphen)
                    </label>
                    <Input
                      id={`${baseId}-badgeId`}
                      value={draft.badgeId}
                      maxLength={64}
                      disabled={!canManage || editingBadgeId !== null}
                      required
                      onChange={(e) => {
                        setIdManuallyEdited(true);
                        patchDraft({ badgeId: e.target.value });
                      }}
                      placeholder="dawn_patrol_ph"
                      className="font-mono"
                    />
                    {editingBadgeId && (
                      <p className="text-xs text-[var(--text-secondary)]">
                        Badge ID is locked when editing an existing badge.
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor={`${baseId}-description`}
                    className="block text-xs font-semibold text-[var(--text-primary)]"
                  >
                    Description (1 to 240 characters)
                  </label>
                  <textarea
                    id={`${baseId}-description`}
                    rows={2}
                    maxLength={240}
                    disabled={!canManage}
                    required
                    value={draft.description}
                    onChange={(e) => patchDraft({ description: e.target.value })}
                    placeholder="Describe how Ka-RacePulse athletes earn this badge."
                    className="flex w-full rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] px-4 py-2.5 text-base text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 disabled:opacity-50"
                  />
                  <p className="text-xs text-[var(--text-secondary)]">
                    {draft.description.trim().length}/240 characters
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label
                      htmlFor={`${baseId}-tier`}
                      className="block text-xs font-semibold text-[var(--text-primary)]"
                    >
                      Tier
                    </label>
                    <Select
                      id={`${baseId}-tier`}
                      value={draft.tier}
                      options={tierOptions}
                      disabled={!canManage}
                      onChange={(next) => {
                        const nextTier = next as BadgeTier;
                        const prevDefaults = BADGE_TIER_META[draft.tier] ?? BADGE_TIER_META.common;
                        const nextDefaults = BADGE_TIER_META[nextTier] ?? BADGE_TIER_META.common;
                        const shouldAdoptColors =
                          draft.primaryColor.toUpperCase() === prevDefaults.defaultPrimary &&
                          draft.secondaryColor.toUpperCase() === prevDefaults.defaultSecondary;
                        patchDraft({
                          tier: nextTier,
                          ...(shouldAdoptColors
                            ? {
                                primaryColor: nextDefaults.defaultPrimary,
                                secondaryColor: nextDefaults.defaultSecondary,
                              }
                            : {}),
                        });
                      }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor={`${baseId}-custom-tier`}
                      className="block text-xs font-semibold text-[var(--text-primary)]"
                    >
                      Custom Tier Label (Optional)
                    </label>
                    <Input
                      id={`${baseId}-custom-tier`}
                      value={draft.customTierLabel}
                      maxLength={24}
                      disabled={!canManage}
                      onChange={(e) => patchDraft({ customTierLabel: e.target.value })}
                      placeholder="e.g. Founder"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor={`${baseId}-category`}
                      className="block text-xs font-semibold text-[var(--text-primary)]"
                    >
                      Category
                    </label>
                    <Select
                      id={`${baseId}-category`}
                      value={draft.category}
                      options={categoryOptions}
                      disabled={!canManage}
                      onChange={(next) => patchDraft({ category: next as BadgeCategory })}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor={`${baseId}-sort-order`}
                      className="block text-xs font-semibold text-[var(--text-primary)]"
                    >
                      Sort Order (0 to 10000)
                    </label>
                    <Input
                      id={`${baseId}-sort-order`}
                      type="number"
                      min={0}
                      max={10000}
                      step={1}
                      disabled={!canManage}
                      value={draft.sortOrder}
                      onChange={(e) => patchDraft({ sortOrder: e.target.value })}
                    />
                  </div>
                </div>
              </fieldset>

              <div className="border-t border-[var(--border-subtle)] pt-5">
                <fieldset className="space-y-4 border-0 p-0 m-0">
                  <legend className="text-sm font-semibold font-display text-[var(--text-primary)]">
                    Artwork, Frame & GPU Motion
                  </legend>

                <div className="space-y-2">
                  <span className="block text-xs font-semibold text-[var(--text-primary)]">
                    Artwork Source
                  </span>
                  <div className="grid grid-cols-2 gap-2 max-w-sm">
                    <button
                      type="button"
                      disabled={!canManage}
                      aria-pressed={draft.artworkType === 'emblem'}
                      onClick={() => patchDraft({ artworkType: 'emblem' })}
                      className={`min-h-11 px-4 rounded-xl border text-xs font-semibold transition-colors ${
                        draft.artworkType === 'emblem'
                          ? 'border-red-600 bg-red-700 text-white'
                          : 'border-[var(--border-control)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                      }`}
                    >
                      Vector Emblem
                    </button>
                    <button
                      type="button"
                      disabled={!canManage}
                      aria-pressed={draft.artworkType === 'upload'}
                      onClick={() => patchDraft({ artworkType: 'upload' })}
                      className={`min-h-11 px-4 rounded-xl border text-xs font-semibold transition-colors ${
                        draft.artworkType === 'upload'
                          ? 'border-red-600 bg-red-700 text-white'
                          : 'border-[var(--border-control)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]'
                      }`}
                    >
                      Custom Image
                    </button>
                  </div>
                </div>

                {draft.artworkType === 'emblem' ? (
                  <div className="space-y-2">
                    <span className="block text-xs font-semibold text-[var(--text-primary)]">
                      Select Vector Emblem (18 presets)
                    </span>
                    <div className="grid grid-cols-3 sm:grid-cols-4 2xl:grid-cols-6 gap-2">
                      {BADGE_EMBLEM_PRESETS.map((preset) => {
                        const selected = draft.emblemId === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            disabled={!canManage}
                            aria-pressed={selected}
                            onClick={() => patchDraft({ emblemId: preset.id })}
                            className={`min-h-11 p-2 rounded-xl border flex flex-col items-center justify-center gap-1.5 text-center transition-colors ${
                              selected
                                ? 'border-red-600 dark:border-red-400 bg-red-500/10'
                                : 'border-[var(--border-control)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)]'
                            }`}
                          >
                            <BadgeArtwork
                              size="sm"
                              badge={{
                                ...previewBadge,
                                artworkType: 'emblem',
                                emblemId: preset.id,
                                animationEffect: 'none',
                              }}
                            />
                            <span className="text-xs leading-tight font-semibold text-[var(--text-primary)] line-clamp-2">
                              {preset.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="glass-inset p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-[var(--text-primary)]">
                          Raster Image Upload (PNG, JPEG, WebP, or AVIF under 2 MB)
                        </p>
                        <p className="text-xs text-[var(--text-secondary)]">
                          SVG files are rejected for security. Stored under badge-assets/{profile.uid}/{draft.badgeId || 'badgeId'}/.
                        </p>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        hidden
                        tabIndex={-1}
                        aria-hidden="true"
                        disabled={!canManage || isFormMutating}
                        accept="image/png,image/jpeg,image/webp,image/avif"
                        id={`${baseId}-artwork-file`}
                        onChange={(e) => void handleFileChange(e.target.files?.[0])}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!canManage || isFormMutating}
                        onClick={() => fileInputRef.current?.click()}
                        className="min-h-11"
                      >
                        <Upload className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>{uploadingArtwork ? 'Uploading...' : 'Upload Image'}</span>
                      </Button>
                    </div>
                    {draft.artworkStoragePath && (
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
                        <span className="font-mono truncate">{draft.artworkStoragePath}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={!canManage || isFormMutating}
                          onClick={() =>
                            patchDraft({ artworkUrl: '', artworkStoragePath: '' })
                          }
                          className="min-h-11"
                        >
                          Clear image
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label
                      htmlFor={`${baseId}-border-style`}
                      className="block text-xs font-semibold text-[var(--text-primary)]"
                    >
                      Border Style
                    </label>
                    <Select
                      id={`${baseId}-border-style`}
                      value={draft.borderStyle}
                      options={borderOptions}
                      disabled={!canManage}
                      onChange={(next) =>
                        patchDraft({ borderStyle: next as BadgeBorderStyle })
                      }
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor={`${baseId}-animation-effect`}
                      className="block text-xs font-semibold text-[var(--text-primary)]"
                    >
                      GPU Animation Effect
                    </label>
                    <Select
                      id={`${baseId}-animation-effect`}
                      value={draft.animationEffect}
                      options={animationOptions}
                      disabled={!canManage}
                      onChange={(next) =>
                        patchDraft({ animationEffect: next as BadgeAnimationEffect })
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <ColorControl
                    id={`${baseId}-primary-color`}
                    label="Primary Color"
                    value={draft.primaryColor}
                    disabled={!canManage}
                    onChange={(primaryColor) => patchDraft({ primaryColor })}
                  />
                  <ColorControl
                    id={`${baseId}-secondary-color`}
                    label="Secondary Color"
                    value={draft.secondaryColor}
                    disabled={!canManage}
                    onChange={(secondaryColor) => patchDraft({ secondaryColor })}
                  />
                </div>
                </fieldset>
              </div>

              <div className="space-y-5 border-t border-[var(--border-subtle)] pt-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label
                      htmlFor={`${baseId}-xp-reward`}
                      className="block text-xs font-semibold text-[var(--text-primary)]"
                    >
                      XP Reward (0 to 50000)
                    </label>
                    <Input
                      id={`${baseId}-xp-reward`}
                      type="number"
                      min={0}
                      max={50000}
                      step={1}
                      disabled={!canManage}
                      value={draft.xpReward}
                      onChange={(e) => patchDraft({ xpReward: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor={`${baseId}-active-from`}
                      className="block text-xs font-semibold text-[var(--text-primary)]"
                    >
                      Active From (Optional)
                    </label>
                    <Input
                      id={`${baseId}-active-from`}
                      type="date"
                      disabled={!canManage}
                      value={draft.activeFrom}
                      onChange={(e) => patchDraft({ activeFrom: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor={`${baseId}-active-until`}
                      className="block text-xs font-semibold text-[var(--text-primary)]"
                    >
                      Active Until (Optional)
                    </label>
                    <Input
                      id={`${baseId}-active-until`}
                      type="date"
                      disabled={!canManage}
                      value={draft.activeUntil}
                      onChange={(e) => patchDraft({ activeUntil: e.target.value })}
                    />
                  </div>
                </div>

                {(draft.activeFrom || draft.activeUntil) && canManage && (
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => patchDraft({ activeFrom: '', activeUntil: '' })}
                      className="min-h-11"
                    >
                      Clear schedule dates
                    </Button>
                  </div>
                )}

                <BadgeRuleFields
                  draft={draft}
                  races={races}
                  disabled={!canManage}
                  onPatchDraft={patchDraft}
                />

                <label
                  htmlFor={`${baseId}-hidden-until-earned`}
                  className="min-h-11 flex items-center justify-between gap-4 px-4 py-2 rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] cursor-pointer"
                >
                  <div>
                    <span className="block text-xs font-semibold text-[var(--text-primary)]">
                      Hidden Until Earned
                    </span>
                    <span className="block text-xs text-[var(--text-secondary)]">
                      Display a mystery silhouette in runner Trophy Cases until unlocked.
                    </span>
                  </div>
                  <input
                    id={`${baseId}-hidden-until-earned`}
                    type="checkbox"
                    role="switch"
                    disabled={!canManage}
                    checked={draft.hiddenUntilEarned}
                    onChange={(e) => patchDraft({ hiddenUntilEarned: e.target.checked })}
                    className="access-switch"
                  />
                </label>
              </div>

              {formError && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-600/40 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-700 dark:text-red-300"
                >
                  {formError}
                </div>
              )}

              {canManage && (
                <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[var(--border-subtle)]">
                  <div className="flex flex-wrap items-center gap-2">
                    {editingBadgeId && (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={isFormMutating}
                          onClick={() => void handleToggleArchive()}
                          className="min-h-11"
                        >
                          {draft.status === 'archived' ? (
                            <RotateCcw className="w-4 h-4 shrink-0" aria-hidden="true" />
                          ) : (
                            <Archive className="w-4 h-4 shrink-0" aria-hidden="true" />
                          )}
                          <span>
                            {archiving
                              ? 'Updating...'
                              : draft.status === 'archived'
                                ? 'Restore Badge'
                                : 'Archive Badge'}
                          </span>
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          disabled={isFormMutating}
                          onClick={() => void handleDelete()}
                          className="min-h-11 text-red-700 dark:text-red-400 hover:border-red-600"
                        >
                          <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                          <span>{deleting ? 'Deleting...' : 'Delete Badge'}</span>
                        </Button>
                      </>
                    )}
                  </div>

                  <Button
                    type="submit"
                    disabled={isFormMutating}
                    className="min-h-11 px-6 bg-red-700 hover:bg-red-600 text-white"
                  >
                    {saving ? (
                      <RefreshCw className="w-4 h-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
                    ) : (
                      <Save className="w-4 h-4 shrink-0" aria-hidden="true" />
                    )}
                    <span>{saving ? 'Saving Badge...' : 'Save Badge'}</span>
                  </Button>
                </div>
              )}
            </form>
        </div>
      )}

      {activeTab === 'grant' && canGrant && (
        <div
          id={`${baseId}-panel-grant`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-grant`}
        >
          <ManualGrantTab
            badges={badges}
            users={users}
            usersLoaded={usersLoaded}
            usersError={usersError}
            canViewUsers={canViewUsers}
            isE2eFixtureMode={isE2eFixtureMode}
            actorUid={profile.uid}
          />
        </div>
      )}

      {activeTab === 'retroactive' && canManage && (
        <div
          id={`${baseId}-panel-retroactive`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-retroactive`}
        >
          <RetroactiveSyncTab isE2eFixtureMode={isE2eFixtureMode} />
        </div>
      )}
    </div>
  );
}
