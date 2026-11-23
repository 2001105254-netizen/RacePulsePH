import { ReactNode, RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAndroidBackHandler } from '../../lib/capacitorAndroid';

interface DialogSurfaceProps {
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  scrollableBody?: boolean;
  titleId: string;
  descriptionId?: string;
  onRequestClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  alert?: boolean;
  variant?: 'modal' | 'sheet';
  dismissOnBackdropClick?: boolean;
  maxWidthCss?: string;
}

// Native top-layer placement provides background inertness and focus containment.
// The portal also keeps overlays outside transformed/backdrop-filter ancestors.
export default function DialogSurface({
  children,
  className = '',
  bodyClassName = '',
  scrollableBody = true,
  titleId,
  descriptionId,
  onRequestClose,
  initialFocusRef,
  alert,
  variant = 'modal',
  dismissOnBackdropClick = false,
  maxWidthCss,
}: DialogSurfaceProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const ignoredCloseEventsRef = useRef(0);
  const onRequestCloseRef = useRef(onRequestClose);
  onRequestCloseRef.current = onRequestClose;
  useAndroidBackHandler(true, () => onRequestCloseRef.current());

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    if (!dialog.open) {
      dialog.showModal();
    }
    initialFocusRef?.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) {
        // React StrictMode re-runs layout effects synchronously, so track queued
        // cleanup close events across the simulated remount before suppressing them.
        ignoredCloseEventsRef.current += 1;
        dialog.close();
      }
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  // Progressive enhancement fallback for browsers without native closedby="any"
  useEffect(() => {
    if (!dismissOnBackdropClick) return;
    const dialog = ref.current;
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;

    const isOutside = (event: PointerEvent) => {
      const rect = dialog.getBoundingClientRect();
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      );
    };

    let pressedOutside = false;
    const onPointerDown = (event: PointerEvent) => {
      pressedOutside = isOutside(event);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (pressedOutside && isOutside(event)) {
        onRequestCloseRef.current();
      }
      pressedOutside = false;
    };

    dialog.addEventListener('pointerdown', onPointerDown);
    dialog.addEventListener('pointerup', onPointerUp);
    return () => {
      dialog.removeEventListener('pointerdown', onPointerDown);
      dialog.removeEventListener('pointerup', onPointerUp);
    };
  }, [dismissOnBackdropClick]);

  if (typeof document === 'undefined') return null;

  const dialogStyle = maxWidthCss
    ? ({ '--rp-sheet-max-w': maxWidthCss } as React.CSSProperties)
    : undefined;

  return createPortal(
    <dialog
      ref={ref}
      style={dialogStyle}
      data-variant={variant}
      className={`rp-dialog ${variant === 'sheet' ? 'rp-sheet' : ''} ${className}`}
      role={alert ? 'alertdialog' : undefined}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      {...(dismissOnBackdropClick ? ({ closedby: 'any' } as Record<string, string>) : {})}
      onCancel={(event) => {
        event.preventDefault();
        onRequestCloseRef.current();
      }}
      onClose={(event) => {
        if (ignoredCloseEventsRef.current > 0) {
          ignoredCloseEventsRef.current -= 1;
          return;
        }
        if (event.currentTarget.open) return;
        onRequestCloseRef.current();
      }}
    >
      {variant === 'sheet' ? (
        <>
          <div className="sm:hidden shrink-0 pt-2 pb-1 flex justify-center" aria-hidden="true">
            <span className="h-1 w-10 rounded-full bg-[var(--border-strong)]/45" />
          </div>
          <div
            className={`relative min-h-0 flex-auto ${
              scrollableBody ? 'overflow-y-auto overscroll-y-contain' : 'flex flex-col overflow-hidden'
            } ${bodyClassName}`}
          >
            {children}
          </div>
        </>
      ) : (
        children
      )}
    </dialog>,
    document.body,
  );
}
