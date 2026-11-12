import { createContext, ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import DialogSurface from './DialogSurface';

export interface ConfirmOptions { title: string; message: string; confirmLabel: string; cancelLabel?: string; destructive?: boolean }
type ToastInput = { title: string; message?: string; tone?: 'success' | 'error' | 'info' };
type Notice = ToastInput & { id: number };
interface Feedback { confirm: (options: ConfirmOptions) => Promise<boolean>; notify: (toast: ToastInput) => void }
const Context = createContext<Feedback | null>(null);
export function useFeedback() { const value = useContext(Context); if (!value) throw new Error('FeedbackProvider is required.'); return value; }

export default function FeedbackProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConfirmOptions | null>(null), [notices, setNotices] = useState<Notice[]>([]);
  const resolve = useRef<((value: boolean) => void) | null>(null);
  const sequence = useRef(0);
  const confirm = useCallback((options: ConfirmOptions) => {
    // Repeated close requests cannot replace a decision that is already open.
    if (resolve.current) return Promise.resolve(false);
    return new Promise<boolean>(done => { resolve.current = done; setPending(options); });
  }, []);
  const finish = (answer: boolean) => { const done = resolve.current; resolve.current = null; setPending(null); done?.(answer); };
  const notify = useCallback((toast: ToastInput) => setNotices(current => [...current.slice(-2), { ...toast, id: ++sequence.current }]), []);
  useEffect(() => () => { resolve.current?.(false); resolve.current = null; }, []);
  return <Context.Provider value={{ confirm, notify }}>
    {children}
    {pending && <ConfirmDialog options={pending} onResult={finish} />}
    {typeof document !== 'undefined' && createPortal(<div className="rp-toast-region" aria-label="Notifications">{notices.map(notice => <Toast key={notice.id} notice={notice} onDismiss={() => setNotices(current => current.filter(item => item.id !== notice.id))} />)}</div>, document.body)}
  </Context.Provider>;
}

function ConfirmDialog({ options, onResult }: { options: ConfirmOptions; onResult: (answer: boolean) => void }) {
  const id = useId(), cancel = useRef<HTMLButtonElement>(null);
  return <DialogSurface className="rp-confirm" titleId={`${id}-title`} descriptionId={`${id}-description`} onRequestClose={() => onResult(false)} initialFocusRef={cancel} alert>
    <div className={`rp-confirm-symbol ${options.destructive ? 'is-destructive' : ''}`}><AlertTriangle size={26} aria-hidden="true" /></div>
    <h2 id={`${id}-title`}>{options.title}</h2>
    <p id={`${id}-description`}>{options.message}</p>
    <div className="rp-confirm-actions">
      <button ref={cancel} className="rp-button rp-button-secondary" onClick={() => onResult(false)}>{options.cancelLabel || 'Cancel'}</button>
      <button className={`rp-button ${options.destructive ? 'rp-button-danger' : 'rp-button-primary'}`} onClick={() => onResult(true)}>{options.confirmLabel}</button>
    </div>
  </DialogSurface>;
}

function Toast({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => { if (paused || notice.tone === 'error') return; const timer = setTimeout(onDismiss, 6500); return () => clearTimeout(timer); }, [paused, notice.id]);
  const Icon = notice.tone === 'success' ? CheckCircle2 : notice.tone === 'error' ? AlertTriangle : Info;
  return <div className={`rp-toast is-${notice.tone || 'info'}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
    <Icon size={24} aria-hidden="true" />
    <div role={notice.tone === 'error' ? 'alert' : 'status'} aria-atomic="true"><strong>{notice.title}</strong>{notice.message && <p>{notice.message}</p>}</div>
    <button className="rp-icon-button" aria-label="Dismiss notification" onClick={onDismiss}><X size={19} /></button>
  </div>;
}
