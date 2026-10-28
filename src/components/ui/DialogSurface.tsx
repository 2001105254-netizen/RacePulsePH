import { ReactNode, RefObject, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface DialogSurfaceProps {
  children: ReactNode;
  className?: string;
  titleId: string;
  descriptionId?: string;
  onRequestClose: () => void;
  initialFocusRef?: RefObject<HTMLElement>;
  alert?: boolean;
}
let openDialogs = 0;
let originalOverflow = '';

// Native top-layer placement provides background inertness and focus containment.
// The portal also keeps overlays outside transformed/backdrop-filter ancestors.
export default function DialogSurface({ children, className = '', titleId, descriptionId, onRequestClose, initialFocusRef, alert }: DialogSurfaceProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    if (openDialogs === 0) originalOverflow = document.body.style.overflow;
    openDialogs += 1;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    initialFocusRef?.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      openDialogs = Math.max(0, openDialogs - 1);
      if (openDialogs === 0) document.body.style.overflow = originalOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <dialog ref={ref} className={`rp-dialog ${className}`} role={alert ? 'alertdialog' : 'dialog'} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event => { event.preventDefault(); onRequestClose(); }}>
      {children}
    </dialog>, document.body,
  );
}
