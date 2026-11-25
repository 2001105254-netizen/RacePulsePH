import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ImagePlus, LocateFixed, MapPin, Trash2, Video, X } from 'lucide-react';
import type { BadgeDefinition, UserBadgeAward } from '../../lib/badges/types';
import {
  E2E_SOCIAL_POSTS_KEY,
  buildDevStarterSocialPosts,
  createDevSocialPostFixture,
  readDevSessionJson,
} from '../../lib/clubs/e2eFixtures';
import { createCommunityRequestId } from '../../lib/runs/communityRunsClient';
import type { RecordedRunSummary } from '../../lib/runs/types';
import { createSocialPost, uploadSocialMediaFile } from '../../lib/social/client';
import {
  MAX_POST_IMAGES,
  MAX_POST_TEXT_CHARS,
  SOCIAL_VISIBILITIES,
  SOCIAL_VISIBILITY_META,
  validateSocialImageFile,
  validateSocialVideoMetadata,
} from '../../lib/social/mediaValidation';
import type {
  SocialLocationPin,
  SocialMediaItem,
  SocialPostRecord,
  SocialVisibility,
} from '../../lib/social/types';
import type { Race, UserProfile } from '../../types';
import DialogSurface from '../ui/DialogSurface';
import { useFeedback } from '../ui/FeedbackProvider';
import { Select, type SelectOption } from '../ui/Select';

export interface SocialPostComposerDialogProps {
  open: boolean;
  profile: UserProfile;
  recordedRuns: RecordedRunSummary[];
  userBadges: UserBadgeAward[];
  badgeCatalog: BadgeDefinition[];
  races: Race[];
  onClose: () => void;
  onPostCreated: (post: SocialPostRecord) => void;
}

interface PendingMediaEntry {
  id: string;
  file: File;
  kind: 'image' | 'video';
  previewUrl: string;
  durationSec?: number;
}

function readVideoDurationSeconds(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const videoEl = document.createElement('video');
    videoEl.preload = 'metadata';
    videoEl.onloadedmetadata = () => {
      const duration = Number(videoEl.duration);
      URL.revokeObjectURL(objectUrl);
      resolve(duration);
    };
    videoEl.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not read video duration. Select an MP4 or WebM clip.'));
    };
    videoEl.src = objectUrl;
  });
}

export default function SocialPostComposerDialog({
  open,
  profile,
  recordedRuns,
  userBadges,
  badgeCatalog,
  races,
  onClose,
  onPostCreated,
}: SocialPostComposerDialogProps) {
  const { notify } = useFeedback();
  const baseId = useId();
  const mountedRef = useRef(true);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<SocialVisibility>('public');
  const [pendingMedia, setPendingMedia] = useState<PendingMediaEntry[]>([]);
  const [mediaKind, setMediaKind] = useState<'none' | 'image' | 'video'>('none');

  const [attachedRunId, setAttachedRunId] = useState('');
  const [attachedBadgeId, setAttachedBadgeId] = useState('');
  const [attachedRaceId, setAttachedRaceId] = useState('');
  const [attachClub, setAttachClub] = useState(Boolean(profile.primaryClubId));

  const [pinLocation, setPinLocation] = useState(false);
  const [locationLabel, setLocationLabel] = useState('');
  const [locationLat, setLocationLat] = useState('');
  const [locationLon, setLocationLon] = useState('');
  const [locating, setLocating] = useState(false);

  const [formError, setFormError] = useState('');
  const [submitStatus, setSubmitStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const pendingMediaRef = useRef<PendingMediaEntry[]>([]);
  pendingMediaRef.current = pendingMedia;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const item of pendingMediaRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  const clearPendingMedia = (entries: PendingMediaEntry[]) => {
    for (const item of entries) {
      URL.revokeObjectURL(item.previewUrl);
    }
  };

  useEffect(() => {
    if (!open) return;
    setFormError('');
    setSubmitStatus('');
  }, [open]);

  if (!open) return null;

  const isE2e = import.meta.env.DEV && profile.uid.startsWith('e2e-');
  const badgeById = new Map(badgeCatalog.map((b) => [b.badgeId, b]));

  const visibilityOptions: SelectOption[] = SOCIAL_VISIBILITIES.map((v) => ({
    value: v,
    label: SOCIAL_VISIBILITY_META[v].label,
  }));

  const runOptions: SelectOption[] = [
    { value: '', label: 'None' },
    ...recordedRuns.slice(0, 12).map((r) => ({
      value: r.runId,
      label: `${r.title} (${(r.distanceM / 1000).toFixed(2)} km)`,
    })),
  ];

  const badgeOptions: SelectOption[] = [
    { value: '', label: 'None' },
    ...userBadges.slice(0, 20).map((ub) => ({
      value: ub.badgeId,
      label: badgeById.get(ub.badgeId)?.name || ub.badgeName || ub.badgeId,
    })),
  ];

  const raceOptions: SelectOption[] = [
    { value: '', label: 'None' },
    ...races.slice(0, 20).map((r) => ({
      value: r.id,
      label: `${r.name} (${r.date})`,
    })),
  ];

  const handleImagePick = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;

    if (mediaKind === 'video') {
      setFormError('Remove the selected video first before attaching photos.');
      return;
    }

    const remaining = MAX_POST_IMAGES - pendingMedia.length;
    if (remaining <= 0) {
      setFormError(`Up to ${MAX_POST_IMAGES} photos can be attached per post.`);
      return;
    }

    const nextEntries: PendingMediaEntry[] = [];
    for (const file of files.slice(0, remaining)) {
      const check = validateSocialImageFile({ name: file.name, type: file.type, size: file.size });
      if (!check.ok) {
        clearPendingMedia(nextEntries);
        setFormError(check.error);
        return;
      }
      nextEntries.push({
        id: `${file.name}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        file,
        kind: 'image',
        previewUrl: URL.createObjectURL(file),
      });
    }

    setFormError('');
    setMediaKind('image');
    setPendingMedia((prev) => [...prev, ...nextEntries]);
  };

  const handleVideoPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const durationSec = await readVideoDurationSeconds(file);
      const check = validateSocialVideoMetadata({
        name: file.name,
        type: file.type,
        size: file.size,
        durationSec,
      });
      if (!check.ok) {
        setFormError(check.error);
        return;
      }
      clearPendingMedia(pendingMedia);
      setFormError('');
      setMediaKind('video');
      setPendingMedia([
        {
          id: `${file.name}_${Date.now()}`,
          file,
          kind: 'video',
          previewUrl: URL.createObjectURL(file),
          durationSec,
        },
      ]);
    } catch (err) {
      setFormError(err instanceof Error && err.message ? err.message : 'Invalid video clip.');
    }
  };

  const handleRemoveMedia = (id: string) => {
    setPendingMedia((prev) => {
      const removed = prev.find((m) => m.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      const next = prev.filter((m) => m.id !== id);
      if (next.length === 0) setMediaKind('none');
      return next;
    });
  };

  const handleCaptureGps = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setFormError('Geolocation is unavailable in this browser. Enter coordinates or uncheck Pin Location.');
      return;
    }
    setLocating(true);
    setFormError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!mountedRef.current) return;
        setLocationLat(pos.coords.latitude.toFixed(6));
        setLocationLon(pos.coords.longitude.toFixed(6));
        if (!locationLabel.trim()) {
          setLocationLabel('Route Snap Spot');
        }
        setLocating(false);
      },
      (err) => {
        if (!mountedRef.current) return;
        setLocating(false);
        setFormError(err.message || 'Unable to lock GPS coordinates for Route Snap.');
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 15_000 },
    );
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const cleanText = text.trim();
    if (!cleanText && pendingMedia.length === 0) {
      setFormError('Write a post note or attach up to 4 photos or a 60s video.');
      textInputRef.current?.focus();
      return;
    }

    let parsedLocation: SocialLocationPin | null = null;
    if (pinLocation) {
      const latNum = Number(locationLat);
      const lonNum = Number(locationLon);
      const cleanLocLabel = locationLabel.trim();
      if (!Number.isFinite(latNum) || !Number.isFinite(lonNum) || latNum < 4 || latNum > 22 || lonNum < 114 || lonNum > 128) {
        setFormError('Route Snap requires valid Philippine latitude (4 to 22) and longitude (114 to 128).');
        return;
      }
      if (!cleanLocLabel) {
        setFormError('Enter a short spot label for your pinned Route Snap.');
        return;
      }
      parsedLocation = { lat: latNum, lon: lonNum, label: cleanLocLabel.slice(0, 80) };
    }

    setSubmitting(true);
    setFormError('');
    try {
      const postId = `post_${createCommunityRequestId().replace(/-/g, '').slice(0, 20)}`;
      const uploadedItems: SocialMediaItem[] = [];

      if (pendingMedia.length > 0) {
        if (isE2e) {
          for (const item of pendingMedia) {
            const storagePath = `social-media/${profile.uid}/${postId}/${item.file.name}`;
            uploadedItems.push({
              storagePath,
              mimeType: item.file.type || (item.kind === 'video' ? 'video/mp4' : 'image/png'),
              sizeBytes: item.file.size,
              url:
                visibility === 'public'
                  ? `https://firebasestorage.googleapis.com/v0/b/racepulseph.firebasestorage.app/o/${encodeURIComponent(storagePath)}?alt=media`
                  : '',
              ...(item.durationSec ? { durationSec: Math.round(item.durationSec * 10) / 10 } : {}),
            });
          }
        } else {
          for (let i = 0; i < pendingMedia.length; i += 1) {
            const item = pendingMedia[i];
            setSubmitStatus(`Uploading media (${i + 1}/${pendingMedia.length})...`);
            const uploaded = await uploadSocialMediaFile(profile.uid, postId, item.file, visibility, {
              durationSec: item.durationSec,
            });
            uploadedItems.push(uploaded);
          }
        }
      }

      setSubmitStatus('Publishing post...');
      const mediaType =
        mediaKind === 'video' ? 'video' : mediaKind === 'image' ? 'images' : 'none';
      const resolvedClubId = attachClub && profile.primaryClubId ? profile.primaryClubId : null;

      let createdPost: SocialPostRecord;
      let linkedCourseLabel = '';

      if (isE2e) {
        const existing =
          readDevSessionJson<SocialPostRecord>(E2E_SOCIAL_POSTS_KEY) ?? buildDevStarterSocialPosts();
        const nextList = createDevSocialPostFixture(existing, {
          postId,
          uid: profile.uid,
          displayName: profile.nickname || profile.displayName || 'Runner',
          username: profile.username,
          visibility,
          text: cleanText,
          mediaType,
          mediaItems: uploadedItems,
          attachedBadgeId: attachedBadgeId || null,
          attachedClubId: resolvedClubId,
          attachedRaceId: attachedRaceId || null,
          attachedRunId: attachedRunId || null,
          location: parsedLocation,
        });
        createdPost = nextList[0];
      } else {
        const res = await createSocialPost({
          postId,
          visibility,
          text: cleanText,
          mediaType,
          mediaItems: uploadedItems,
          attachedBadgeId: attachedBadgeId || null,
          attachedClubId: resolvedClubId,
          attachedRaceId: attachedRaceId || null,
          attachedRunId: attachedRunId || null,
          location: parsedLocation,
        });
        createdPost = res.post;
        if (res.post.linkedCourse?.raceName) {
          linkedCourseLabel = `Linked to ${res.post.linkedCourse.raceName} (${res.post.linkedCourse.distanceLabel}).`;
        }
      }

      if (!mountedRef.current) return;
      clearPendingMedia(pendingMedia);
      setPendingMedia([]);
      setMediaKind('none');
      setText('');
      setPinLocation(false);
      setLocationLabel('');
      setLocationLat('');
      setLocationLon('');
      notify({
        tone: 'success',
        title: 'Post published',
        message: linkedCourseLabel || undefined,
      });
      onPostCreated(createdPost);
      onClose();
    } catch (err) {
      if (!mountedRef.current) return;
      setFormError(err instanceof Error && err.message ? err.message : 'Unable to publish post.');
    } finally {
      if (mountedRef.current) {
        setSubmitting(false);
        setSubmitStatus('');
      }
    }
  };

  return (
    <DialogSurface
      variant="sheet"
      dismissOnBackdropClick={!submitting}
      maxWidthCss="36rem"
      titleId={`${baseId}-title`}
      onRequestClose={() => {
        if (!submitting) onClose();
      }}
      bodyClassName="p-4 sm:p-6 space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5 min-w-0">
          <h2 id={`${baseId}-title`} className="font-display font-semibold text-lg text-[var(--text-primary)]">
            Create Community Post
          </h2>
          <p className="text-xs font-normal text-[var(--text-secondary)]">
            Share a run update, badge milestone, race recap, or route snap.
          </p>
        </div>
        <button
          type="button"
          disabled={submitting}
          onClick={() => {
            clearPendingMedia(pendingMedia);
            setPendingMedia([]);
            setMediaKind('none');
            onClose();
          }}
          aria-label="Close post composer"
          className="min-h-11 min-w-11 flex items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0 cursor-pointer"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={`${baseId}-text`} className="text-xs font-semibold text-[var(--text-primary)]">
              Post caption
            </label>
            <span className="font-mono text-xs tabular-nums text-[var(--text-secondary)]">
              {text.length}/{MAX_POST_TEXT_CHARS}
            </span>
          </div>
          <textarea
            ref={textInputRef}
            id={`${baseId}-text`}
            rows={4}
            maxLength={MAX_POST_TEXT_CHARS}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={Boolean(formError)}
            aria-describedby={formError ? `${baseId}-err` : undefined}
            disabled={submitting}
            placeholder="Share pace notes, hydration checkpoints, or finish reflections..."
            className="w-full rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] p-3.5 text-sm font-normal text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${baseId}-vis`} className="block text-xs font-semibold text-[var(--text-primary)]">
            Visibility
          </label>
          <Select
            id={`${baseId}-vis`}
            ariaLabel="Post visibility"
            value={visibility}
            options={visibilityOptions}
            onChange={(v) => setVisibility(v as SocialVisibility)}
            disabled={submitting}
          />
          <p className="text-xs font-normal text-[var(--text-secondary)]">
            {SOCIAL_VISIBILITY_META[visibility].description}
          </p>
        </div>

        {/* Media Attachments: <= 4 photos OR 1 <= 60s video */}
        <div className="space-y-2">
          <span className="block text-xs font-semibold text-[var(--text-primary)]">
            Media (up to 4 photos under 8 MB or 1 video under 30 MB / 60s)
          </span>
          <div className="flex flex-wrap gap-2">
            <label className="min-h-11 px-3.5 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer">
              <ImagePlus className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
              <span>Add Photos ({mediaKind === 'image' ? pendingMedia.length : 0}/{MAX_POST_IMAGES})</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/avif"
                multiple
                disabled={submitting || mediaKind === 'video' || pendingMedia.length >= MAX_POST_IMAGES}
                onChange={handleImagePick}
                className="sr-only"
              />
            </label>
            <label className="min-h-11 px-3.5 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer">
              <Video className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
              <span>Attach Short Video</span>
              <input
                type="file"
                accept="video/mp4,video/webm"
                disabled={submitting || mediaKind === 'image'}
                onChange={(e) => void handleVideoPick(e)}
                className="sr-only"
              />
            </label>
          </div>

          {pendingMedia.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              {pendingMedia.map((m) => (
                <div key={m.id} className="relative rounded-xl overflow-hidden border border-[var(--border-default)] bg-[var(--surface-inset)]">
                  {m.kind === 'video' ? (
                    <video src={m.previewUrl} muted playsInline className="w-full h-24 object-cover" />
                  ) : (
                    <img src={m.previewUrl} alt="Selected upload preview" className="w-full h-24 object-cover" />
                  )}
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => handleRemoveMedia(m.id)}
                    aria-label={`Remove ${m.file.name}`}
                    className="absolute top-1 right-1 min-h-9 min-w-9 rounded-lg bg-zinc-950/80 text-white flex items-center justify-center cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Optional Run / Badge / Race / Club links */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="space-y-1">
            <label htmlFor={`${baseId}-run`} className="block text-xs font-semibold text-[var(--text-secondary)]">
              Attach Run
            </label>
            <Select
              id={`${baseId}-run`}
              ariaLabel="Attach recorded run"
              value={attachedRunId}
              options={runOptions}
              onChange={setAttachedRunId}
              disabled={submitting}
              size="sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${baseId}-badge`} className="block text-xs font-semibold text-[var(--text-secondary)]">
              Attach Badge
            </label>
            <Select
              id={`${baseId}-badge`}
              ariaLabel="Attach earned badge"
              value={attachedBadgeId}
              options={badgeOptions}
              onChange={setAttachedBadgeId}
              disabled={submitting}
              size="sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${baseId}-race`} className="block text-xs font-semibold text-[var(--text-secondary)]">
              Attach Race
            </label>
            <Select
              id={`${baseId}-race`}
              ariaLabel="Attach RacePulsePH event"
              value={attachedRaceId}
              options={raceOptions}
              onChange={setAttachedRaceId}
              disabled={submitting}
              size="sm"
            />
          </div>
        </div>

        {profile.primaryClubId && (
          <label className="min-h-11 px-3 py-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)] cursor-pointer">
            <input
              type="checkbox"
              checked={attachClub}
              onChange={(e) => setAttachClub(e.target.checked)}
              className="w-4 h-4 accent-red-700"
            />
            <span>Tag your primary club on this update</span>
          </label>
        )}

        {/* Route Snap Location Pin */}
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="min-h-11 inline-flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)] cursor-pointer">
              <input
                type="checkbox"
                checked={pinLocation}
                onChange={(e) => setPinLocation(e.target.checked)}
                className="w-4 h-4 accent-red-700"
              />
              <MapPin className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
              <span>Pin Location (Route Snap)</span>
            </label>
            {pinLocation && (
              <button
                type="button"
                disabled={locating || submitting}
                onClick={handleCaptureGps}
                className="min-h-11 px-3 rounded-lg border border-[var(--border-button)] bg-[var(--surface-card)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer"
              >
                <LocateFixed className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                <span>{locating ? 'Locating...' : 'Use My GPS'}</span>
              </button>
            )}
          </div>

          {pinLocation && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                aria-label="Route snap spot label"
                maxLength={80}
                value={locationLabel}
                onChange={(e) => setLocationLabel(e.target.value)}
                placeholder="Spot label (e.g. Burnham Km 5)"
                className="sm:col-span-3 min-h-11 rounded-xl border border-[var(--border-control)] bg-[var(--surface-card)] px-3 text-sm text-[var(--text-primary)]"
              />
              <input
                aria-label="Latitude"
                value={locationLat}
                onChange={(e) => setLocationLat(e.target.value)}
                placeholder="Lat (e.g. 16.4120)"
                className="min-h-11 rounded-xl border border-[var(--border-control)] bg-[var(--surface-card)] px-3 text-xs font-mono text-[var(--text-primary)]"
              />
              <input
                aria-label="Longitude"
                value={locationLon}
                onChange={(e) => setLocationLon(e.target.value)}
                placeholder="Lon (e.g. 120.5930)"
                className="min-h-11 rounded-xl border border-[var(--border-control)] bg-[var(--surface-card)] px-3 text-xs font-mono text-[var(--text-primary)]"
              />
              <span className="text-xs font-normal text-[var(--text-secondary)] flex items-center">
                Snaps within 100 m link to official courses.
              </span>
            </div>
          )}
        </div>

        {formError && (
          <p id={`${baseId}-err`} role="alert" className="text-xs font-semibold text-red-700 dark:text-red-400">
            {formError}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="min-h-11 px-4 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] text-xs font-semibold text-[var(--text-primary)] cursor-pointer disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
          >
            {submitStatus || 'Publish Post'}
          </button>
        </div>
      </form>
    </DialogSurface>
  );
}
