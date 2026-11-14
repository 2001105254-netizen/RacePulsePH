import React, { useId, useRef, useState } from 'react';
import {
  Calendar,
  Check,
  Copy,
  Download,
  ExternalLink,
  Flag,
  Timer,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import DialogSurface from './ui/DialogSurface';
import { Button } from './ui/button';
import {
  exportHighlightSocialCardPng,
  formatHighlightShareSummary,
  formatReadableDate,
  sanitizeHexColor,
} from '../lib/highlights';
import { RunnerHighlight } from '../types';

interface FinisherDossierModalProps {
  highlight: RunnerHighlight;
  onClose: () => void;
  onViewLeaderboard?: (raceId?: string) => void;
}

export default function FinisherDossierModal({
  highlight,
  onClose,
  onViewLeaderboard,
}: FinisherDossierModalProps) {
  const titleId = useId();
  const descId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [downloadingPng, setDownloadingPng] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [copiedSummary, setCopiedSummary] = useState(false);

  const isDuo = highlight.mode === 'duo';
  const accent = sanitizeHexColor(highlight.accentColor, '#ff3b30');
  const displayName =
    isDuo && highlight.partnerName
      ? `${highlight.runnerName} & ${highlight.partnerName}`
      : highlight.runnerName;
  const displayBib =
    isDuo && highlight.partnerBibNumber
      ? `#${highlight.bibNumber} / #${highlight.partnerBibNumber}`
      : `#${highlight.bibNumber}`;

  const handleDownloadCard = async () => {
    setDownloadingPng(true);
    setDownloadError(null);
    try {
      await exportHighlightSocialCardPng(highlight);
    } catch {
      setDownloadError('Could not generate the PNG card on this device. You can still copy the summary.');
    } finally {
      setDownloadingPng(false);
    }
  };

  const handleCopySummary = async () => {
    try {
      await navigator.clipboard.writeText(formatHighlightShareSummary(highlight));
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2400);
    } catch {
      setDownloadError('Clipboard access is unavailable here.');
    }
  };

  return (
    <DialogSurface
      titleId={titleId}
      descriptionId={descId}
      onRequestClose={onClose}
      initialFocusRef={closeBtnRef as React.RefObject<HTMLElement>}
      className="m-auto w-[min(94vw,820px)] max-h-[90vh] overflow-y-auto rounded-[24px] border border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] p-0 shadow-2xl"
    >
      <div className="grid grid-cols-1 md:grid-cols-12">
        {/* Left: High-Res Collectible Visual Frame */}
        <div className="md:col-span-5 relative min-h-[300px] sm:min-h-[360px] bg-zinc-950 overflow-hidden">
          {isDuo ? (
            <>
              <div className="pp-duo-left">
                {highlight.photoUrl ? (
                  <img src={highlight.photoUrl} alt={highlight.runnerName} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-zinc-900" />
                )}
              </div>
              <div className="pp-duo-right">
                {highlight.partnerPhotoUrl || highlight.photoUrl ? (
                  <img
                    src={highlight.partnerPhotoUrl || highlight.photoUrl}
                    alt={highlight.partnerName || `${highlight.runnerName} partner`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-zinc-800" />
                )}
              </div>
              <div className="pp-duo-slash" style={{ '--card-accent': accent } as React.CSSProperties} aria-hidden="true" />
              <span className="pp-sync-badge" style={{ '--card-accent': accent } as React.CSSProperties}>
                SYNC
              </span>
            </>
          ) : highlight.photoUrl ? (
            <img src={highlight.photoUrl} alt={highlight.runnerName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-zinc-900" />
          )}

          <div className="pp-contrast-scrim" aria-hidden="true" />

          <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between gap-2">
            <span
              className="px-2.5 py-1 rounded-md text-xs font-mono font-semibold text-white bg-black/80 border"
              style={{ borderColor: accent }}
            >
              {highlight.placement}
            </span>
            <span className="px-2.5 py-1 rounded-md text-xs font-mono font-semibold text-white bg-black/80 border border-white/20">
              {isDuo ? 'DUO' : 'SOLO'} {highlight.distance}
            </span>
          </div>

          <div className="absolute bottom-3 left-3 right-3 z-10 space-y-1 text-white">
            {highlight.badgeStamp && (
              <span className="inline-block px-2 py-0.5 rounded bg-amber-300 text-zinc-950 text-[11px] font-mono font-semibold uppercase">
                {highlight.badgeStamp}
              </span>
            )}
            <p className="font-mono text-xs text-zinc-200 truncate">{highlight.raceName}</p>
            <p className="font-display text-lg font-semibold leading-tight truncate">{displayName}</p>
          </div>
        </div>

        {/* Right: Finisher Telemetry Breakdown & Actions */}
        <div className="md:col-span-7 p-5 sm:p-6 flex flex-col justify-between gap-5">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-mono uppercase tracking-wider text-red-700 dark:text-red-400 font-semibold">
                  Finisher Dossier
                </p>
                <h2 id={titleId} className="font-display text-2xl font-semibold text-[var(--text-primary)] leading-tight mt-1">
                  {displayName}
                </h2>
                <p id={descId} className="text-sm text-[var(--text-secondary)] mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex items-center gap-1.5">
                    <Flag className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                    <span>{highlight.raceName}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                    <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{formatReadableDate(highlight.raceDate)}</span>
                  </span>
                </p>
              </div>

              <button
                ref={closeBtnRef}
                type="button"
                onClick={onClose}
                aria-label="Close finisher dossier"
                className="min-h-11 min-w-11 shrink-0 rounded-full border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] flex items-center justify-center text-[var(--text-primary)] transition"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {/* Official Timing Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3">
                <span className="text-xs font-mono text-[var(--text-secondary)] flex items-center gap-1.5">
                  <Timer className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                  Finish Time
                </span>
                <p className="font-mono text-lg font-semibold text-[var(--text-primary)] mt-1">
                  {highlight.chipTime}
                </p>
              </div>

              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3">
                <span className="text-xs font-mono text-[var(--text-secondary)] flex items-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                  {isDuo ? 'Combined Avg Pace' : 'Official Pace'}
                </span>
                <p className="font-mono text-lg font-semibold text-[var(--text-primary)] mt-1">
                  {isDuo && highlight.combinedAvgPace ? highlight.combinedAvgPace : highlight.pace}
                </p>
              </div>

              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3">
                <span className="text-xs font-mono text-[var(--text-secondary)]">
                  {isDuo ? 'Runner 1 Split' : 'Gun Start'}
                </span>
                <p className="font-mono text-sm font-semibold text-[var(--text-primary)] mt-1">
                  {isDuo ? (highlight.soloSplitTime || highlight.chipTime) : (highlight.gunTime || '00:00:00')}
                </p>
              </div>

              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3">
                <span className="text-xs font-mono text-[var(--text-secondary)]">
                  {isDuo ? 'Runner 2 Split' : 'Finish'}
                </span>
                <p className="font-mono text-sm font-semibold text-[var(--text-primary)] mt-1">
                  {isDuo ? (highlight.partnerSplitTime || highlight.gunTime || highlight.chipTime) : (highlight.splitPace || highlight.chipTime)}
                </p>
              </div>
            </div>

            {/* Metadata Strip */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-[var(--text-secondary)]">
              <span>
                Bib: <strong className="text-[var(--text-primary)] font-semibold">{displayBib}</strong>
              </span>
              {highlight.runClub && (
                <span className="inline-flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" aria-hidden="true" />
                  <strong className="text-[var(--text-primary)] font-semibold">{highlight.runClub}</strong>
                </span>
              )}
              {highlight.raceCode && (
                <span>
                  Code: <strong className="text-[var(--text-primary)] font-semibold">{highlight.raceCode}</strong>
                </span>
              )}
            </div>

            {downloadError && (
              <p role="alert" className="text-xs text-red-700 dark:text-red-400 font-medium">
                {downloadError}
              </p>
            )}
          </div>

          {/* Action Bar */}
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2.5 pt-3 border-t border-[var(--border-default)]">
            <Button
              type="button"
              onClick={handleDownloadCard}
              disabled={downloadingPng}
              className="h-11 px-4 text-xs flex-1 sm:flex-initial"
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              <span>{downloadingPng ? 'Rendering card...' : 'Download PNG Card'}</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleCopySummary}
              className="h-11 px-4 text-xs"
            >
              {copiedSummary ? (
                <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              ) : (
                <Copy className="w-4 h-4" aria-hidden="true" />
              )}
              <span>{copiedSummary ? 'Copied summary' : 'Copy share text'}</span>
            </Button>

            {onViewLeaderboard && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onClose();
                  onViewLeaderboard(highlight.raceId);
                }}
                className="h-11 px-4 text-xs sm:ml-auto"
              >
                <span>View event leaderboard</span>
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </DialogSurface>
  );
}
