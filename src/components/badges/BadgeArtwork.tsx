import type { CSSProperties } from 'react';
import { HelpCircle } from 'lucide-react';
import '../../styles/badges.css';
import { isSafeBadgeArtworkUrl } from '../../lib/badges/client';
import {
  BADGE_TIER_META,
  getBadgeEmblemPreset,
  sanitizeHexColor,
} from '../../lib/badges/presets';
import type {
  BadgeDefinition,
  SvgColorToken,
  SvgPrimitive,
} from '../../lib/badges/types';
import { cn } from '../../lib/utils';

export type BadgeArtworkSize = 'sm' | 'md' | 'lg' | 'xl';

export type BadgeArtworkInput = Pick<
  BadgeDefinition,
  | 'badgeId'
  | 'name'
  | 'tier'
  | 'artworkType'
  | 'emblemId'
  | 'artworkUrl'
  | 'borderStyle'
  | 'primaryColor'
  | 'secondaryColor'
  | 'animationEffect'
>;

export interface BadgeArtworkProps {
  badge: BadgeArtworkInput;
  size?: BadgeArtworkSize;
  locked?: boolean;
  mystery?: boolean;
  className?: string;
}

function resolveSvgToken(
  token: SvgColorToken | undefined,
  primary: string,
  secondary: string,
): string | undefined {
  if (!token) return undefined;
  if (token === 'primary') return primary;
  if (token === 'secondary') return secondary;
  return token;
}

function renderSvgPrimitive(
  primitive: SvgPrimitive,
  index: number,
  primary: string,
  secondary: string,
) {
  switch (primitive.kind) {
    case 'path':
      return (
        <path
          key={index}
          d={primitive.d}
          fill={resolveSvgToken(primitive.fill, primary, secondary) ?? 'none'}
          stroke={resolveSvgToken(primitive.stroke, primary, secondary)}
          strokeWidth={primitive.strokeWidth}
          strokeLinecap={primitive.strokeLinecap}
          strokeLinejoin={primitive.strokeLinejoin}
          opacity={primitive.opacity}
        />
      );
    case 'circle':
      return (
        <circle
          key={index}
          cx={primitive.cx}
          cy={primitive.cy}
          r={primitive.r}
          fill={resolveSvgToken(primitive.fill, primary, secondary) ?? 'none'}
          stroke={resolveSvgToken(primitive.stroke, primary, secondary)}
          strokeWidth={primitive.strokeWidth}
          opacity={primitive.opacity}
        />
      );
    case 'polygon':
      return (
        <polygon
          key={index}
          points={primitive.points}
          fill={resolveSvgToken(primitive.fill, primary, secondary) ?? 'none'}
          stroke={resolveSvgToken(primitive.stroke, primary, secondary)}
          strokeWidth={primitive.strokeWidth}
          strokeLinejoin={primitive.strokeLinejoin}
          opacity={primitive.opacity}
        />
      );
    case 'rect':
      return (
        <rect
          key={index}
          x={primitive.x}
          y={primitive.y}
          width={primitive.width}
          height={primitive.height}
          rx={primitive.rx}
          fill={resolveSvgToken(primitive.fill, primary, secondary) ?? 'none'}
          stroke={resolveSvgToken(primitive.stroke, primary, secondary)}
          strokeWidth={primitive.strokeWidth}
          opacity={primitive.opacity}
        />
      );
    case 'line':
      return (
        <line
          key={index}
          x1={primitive.x1}
          y1={primitive.y1}
          x2={primitive.x2}
          y2={primitive.y2}
          stroke={resolveSvgToken(primitive.stroke, primary, secondary) ?? primary}
          strokeWidth={primitive.strokeWidth}
          strokeLinecap={primitive.strokeLinecap}
          opacity={primitive.opacity}
        />
      );
  }
}

function BadgeEmblemSvg({
  emblemId,
  primary,
  secondary,
}: {
  emblemId: string | undefined;
  primary: string;
  secondary: string;
}) {
  const preset = getBadgeEmblemPreset(emblemId);
  return (
    <svg
      viewBox={preset.viewBox}
      className="rp-badge-emblem-svg"
      aria-hidden="true"
      focusable="false"
    >
      {preset.primitives.map((primitive, index) =>
        renderSvgPrimitive(primitive, index, primary, secondary),
      )}
    </svg>
  );
}

export function BadgeArtwork({
  badge,
  size = 'md',
  locked = false,
  mystery = false,
  className,
}: BadgeArtworkProps) {
  const tierDefaults = BADGE_TIER_META[badge.tier] ?? BADGE_TIER_META.common;
  const primary = sanitizeHexColor(badge.primaryColor, tierDefaults.defaultPrimary);
  const secondary = sanitizeHexColor(badge.secondaryColor, tierDefaults.defaultSecondary);
  const borderStyle = badge.borderStyle || 'solid-ring';
  const animationEffect = badge.animationEffect || 'none';

  const safeUploadUrl =
    !mystery &&
    badge.artworkType === 'upload' &&
    isSafeBadgeArtworkUrl(badge.artworkUrl)
      ? badge.artworkUrl.trim()
      : '';

  const showAnimations = !locked && !mystery && animationEffect !== 'none';

  const crestStyle: CSSProperties = mystery
    ? {}
    : ({
        '--badge-primary': primary,
        '--badge-secondary': secondary,
      } as CSSProperties);

  return (
    <span
      aria-hidden="true"
      data-badge-id={mystery ? undefined : badge.badgeId}
      data-badge-border={mystery ? 'mystery' : borderStyle}
      data-badge-anim={showAnimations ? animationEffect : 'none'}
      data-badge-state={mystery ? 'mystery' : locked ? 'locked' : 'unlocked'}
      style={crestStyle}
      className={cn(
        'rp-badge-crest',
        `rp-badge-size-${size}`,
        !mystery && `rp-badge-border-${borderStyle}`,
        showAnimations && `rp-badge-anim-${animationEffect}`,
        locked && !mystery && 'is-locked',
        mystery && 'is-mystery',
        className,
      )}
    >
      {showAnimations && animationEffect === 'pulse-glow' && (
        <span className="rp-badge-fx-aura" />
      )}
      {showAnimations && animationEffect === 'flame-aura' && (
        <span className="rp-badge-fx-flame" />
      )}
      {showAnimations && animationEffect === 'sparkle-orbit' && (
        <span className="rp-badge-fx-orbit">
          <span className="rp-badge-orbit-dot is-a" />
          <span className="rp-badge-orbit-dot is-b" />
          <span className="rp-badge-orbit-dot is-c" />
        </span>
      )}
      <span className="rp-badge-frame">
        <span className={cn('rp-badge-core', Boolean(safeUploadUrl) && 'has-upload')}>
          {mystery ? (
            <HelpCircle className="rp-badge-mystery-icon" aria-hidden="true" />
          ) : safeUploadUrl ? (
            <img
              src={safeUploadUrl}
              alt=""
              loading="lazy"
              className="rp-badge-upload-img"
            />
          ) : (
            <BadgeEmblemSvg
              emblemId={badge.emblemId}
              primary={primary}
              secondary={secondary}
            />
          )}
        </span>
        {showAnimations && animationEffect === 'shimmer-sweep' && (
          <span className="rp-badge-fx-shimmer" />
        )}
      </span>
    </span>
  );
}

export default BadgeArtwork;
