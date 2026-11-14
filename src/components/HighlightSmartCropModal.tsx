import React, { useId, useRef, useState } from 'react';
import { Check, Eye, EyeOff, RotateCcw, X, ZoomIn } from 'lucide-react';
import DialogSurface from './ui/DialogSurface';
import { Button } from './ui/button';
import { bakeSmartCropToDataUrl, clampNumber } from '../lib/highlights';

interface HighlightSmartCropModalProps {
  sourceUrl: string;
  label: string;
  aspectRatio?: number; // width / height, e.g. 260/340
  targetWidth?: number;
  targetHeight?: number;
  onCancel: () => void;
  onConfirm: (croppedDataUrl: string) => void;
}

export default function HighlightSmartCropModal({
  sourceUrl,
  label,
  aspectRatio = 260 / 340,
  targetWidth = 520,
  targetHeight = 680,
  onCancel,
  onConfirm,
}: HighlightSmartCropModalProps) {
  const titleId = useId();
  const descId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const [zoom, setZoom] = useState(1.05);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [showContrastGuard, setShowContrastGuard] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);

  const dragRef = useRef<{ active: boolean; startX: number; startY: number; baseX: number; baseY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
  });

  const frameRef = useRef<HTMLDivElement | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      baseX: offsetX,
      baseY: offsetY,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || !frameRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    const dx = (e.clientX - dragRef.current.startX) / Math.max(40, rect.width * 0.45);
    const dy = (e.clientY - dragRef.current.startY) / Math.max(40, rect.height * 0.45);
    setOffsetX(clampNumber(dragRef.current.baseX + dx, -1, 1));
    setOffsetY(clampNumber(dragRef.current.baseY + dy, -1, 1));
  };

  const handlePointerUp = () => {
    dragRef.current.active = false;
  };

  const handleApplyCrop = async () => {
    setSaving(true);
    setCropError(null);
    try {
      const baked = await bakeSmartCropToDataUrl({
        sourceUrl,
        zoom,
        offsetX,
        offsetY,
        targetWidth,
        targetHeight,
      });
      onConfirm(baked);
    } catch {
      setCropError('Could not process this image. Please choose another JPG or PNG file.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogSurface
      titleId={titleId}
      descriptionId={descId}
      onRequestClose={onCancel}
      initialFocusRef={closeBtnRef as React.RefObject<HTMLElement>}
      className="m-auto w-[min(94vw,520px)] max-h-[92vh] overflow-y-auto rounded-[24px] border border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] p-5 sm:p-6 shadow-2xl"
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="font-display text-lg font-semibold text-[var(--text-primary)]">
              Smart Crop &amp; Contrast Guard
            </h2>
            <p id={descId} className="text-xs text-[var(--text-secondary)] mt-0.5">
              Drag and zoom {label} inside the locked frame.
            </p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onCancel}
            aria-label="Cancel crop"
            className="min-h-11 min-w-11 rounded-full border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] flex items-center justify-center"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Fixed Aspect Interactive Drag Frame */}
        <div className="flex justify-center">
          <div
            ref={frameRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="relative w-full max-w-[260px] rounded-2xl overflow-hidden border-2 border-red-600 bg-zinc-950 select-none touch-none cursor-grab active:cursor-grabbing"
            style={{ aspectRatio: String(aspectRatio) }}
          >
            <img
              src={sourceUrl}
              alt="Crop preview"
              draggable={false}
              className="w-full h-full object-cover pointer-events-none"
              style={{
                transform: `translate3d(${(offsetX * 28).toFixed(1)}%, ${(offsetY * 28).toFixed(1)}%, 0) scale(${zoom.toFixed(2)})`,
                transformOrigin: 'center center',
              }}
            />

            {/* Live 45% Dark Contrast Guard Preview */}
            {showContrastGuard && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(8,8,12,0.5) 0%, rgba(8,8,12,0) 26%, rgba(8,8,12,0.18) 54%, rgba(8,8,12,0.94) 100%)',
                }}
              >
                <div className="absolute bottom-3 left-3 right-3 text-white space-y-0.5">
                  <p className="font-mono text-[11px] text-zinc-300">CONTRAST GUARD PREVIEW</p>
                  <p className="font-display text-base font-semibold">Runner Telemetry</p>
                  <p className="font-mono text-xs text-zinc-200">01:24:18 &bull; 3:59 /km</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Zoom & Scrim Controls */}
        <div className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="pp-crop-zoom" className="text-xs font-mono font-semibold flex items-center gap-1.5 text-[var(--text-primary)]">
              <ZoomIn className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
              <span>Zoom</span>
            </label>
            <span className="text-xs font-mono text-[var(--text-secondary)]">{zoom.toFixed(2)}x</span>
          </div>
          <input
            id="pp-crop-zoom"
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full accent-red-600 cursor-pointer"
          />

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowContrastGuard((v) => !v)}
              className="min-h-11 px-3 py-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[var(--surface-hover)]"
            >
              {showContrastGuard ? <Eye className="w-3.5 h-3.5" aria-hidden="true" /> : <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />}
              <span>{showContrastGuard ? 'Scrim On' : 'Scrim Off'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setZoom(1.05);
                setOffsetX(0);
                setOffsetY(0);
              }}
              className="min-h-11 px-3 py-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[var(--surface-hover)]"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Reset framing</span>
            </button>
          </div>
        </div>

        {cropError && (
          <p role="alert" className="text-xs text-red-700 dark:text-red-400 font-medium">
            {cropError}
          </p>
        )}

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <Button type="button" variant="outline" onClick={onCancel} className="h-11 px-4 text-xs">
            Cancel
          </Button>
          <Button type="button" onClick={handleApplyCrop} disabled={saving} className="h-11 px-4 text-xs">
            <Check className="w-4 h-4" aria-hidden="true" />
            <span>{saving ? 'Baking crop...' : 'Apply crop'}</span>
          </Button>
        </div>
      </div>
    </DialogSurface>
  );
}
