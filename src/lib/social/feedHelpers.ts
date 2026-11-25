import type {
  RouteSnapPin,
  SocialPostRecord,
  SocialVisibility,
} from './types';

export type RouteSnapFilterScope = 'off' | SocialVisibility;

export function canRepostSocialPost(
  post: Pick<SocialPostRecord, 'visibility' | 'deletedAt' | 'hiddenByModeration'> | null | undefined,
): boolean {
  if (!post) return false;
  if (post.deletedAt || post.hiddenByModeration === true) return false;
  return post.visibility === 'public';
}

export function collectUnsignedMediaPaths(
  posts: readonly SocialPostRecord[],
  snaps: readonly RouteSnapPin[],
): string[] {
  const paths = new Set<string>();

  for (const post of posts) {
    if (!Array.isArray(post.mediaItems)) continue;
    for (const item of post.mediaItems) {
      if (item?.storagePath && !item.url) {
        paths.add(item.storagePath.trim());
      }
    }
  }

  for (const snap of snaps) {
    if (snap?.thumbnailPath && !snap.thumbnailUrl) {
      paths.add(snap.thumbnailPath.trim());
    }
  }

  return Array.from(paths).filter(Boolean);
}

export function filterSnapsByScope(
  snaps: readonly RouteSnapPin[],
  scope: RouteSnapFilterScope,
  publicationId?: string | null,
): RouteSnapPin[] {
  if (scope === 'off') return [];
  const cleanPubId = typeof publicationId === 'string' ? publicationId.trim() : '';

  return snaps.filter((snap) => {
    if (!snap) return false;
    if (snap.visibility !== scope) return false;
    if (cleanPubId && snap.publicationId && snap.publicationId !== cleanPubId) {
      return false;
    }
    return true;
  });
}

export function applyBlockedUserToPosts(
  posts: readonly SocialPostRecord[],
  blockedUid: string,
): SocialPostRecord[] {
  const target = blockedUid.trim();
  if (!target) return [...posts];
  return posts.filter((post) => post.uid !== target);
}
