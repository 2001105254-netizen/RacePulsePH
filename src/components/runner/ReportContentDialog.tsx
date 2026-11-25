import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Flag, X } from 'lucide-react';
import { createCommunityRequestId } from '../../lib/runs/communityRunsClient';
import { submitContentReport } from '../../lib/social/client';
import { REPORT_REASONS, REPORT_REASON_META } from '../../lib/social/mediaValidation';
import type { ContentReportReason, ContentReportRecord, ContentReportTargetType } from '../../lib/social/types';
import {
  E2E_CONTENT_REPORTS_KEY,
  readDevSessionJson,
  submitDevReportFixture,
} from '../../lib/clubs/e2eFixtures';
import DialogSurface from '../ui/DialogSurface';
import { useFeedback } from '../ui/FeedbackProvider';
import { Select, type SelectOption } from '../ui/Select';

export interface ReportContentDialogProps {
  open: boolean;
  actorUid: string;
  targetType: ContentReportTargetType;
  targetId: string;
  targetParentId?: string;
  targetUid?: string;
  targetLabel: string;
  onClose: () => void;
  onSubmitted?: () => void;
}

export default function ReportContentDialog({
  open,
  actorUid,
  targetType,
  targetId,
  targetParentId,
  targetUid,
  targetLabel,
  onClose,
  onSubmitted,
}: ReportContentDialogProps) {
  const { notify } = useFeedback();
  const baseId = useId();
  const mountedRef = useRef(true);
  const [reason, setReason] = useState<ContentReportReason>('spam');
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setReason('spam');
    setDetails('');
    setError('');
  }, [open, targetType, targetId]);

  if (!open) return null;

  const isE2e = import.meta.env.DEV && actorUid.startsWith('e2e-');
  const reasonOptions: SelectOption[] = REPORT_REASONS.map((r) => ({
    value: r,
    label: REPORT_REASON_META[r],
  }));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const reportId = `rep_${createCommunityRequestId().replace(/-/g, '').slice(0, 20)}`;
      if (isE2e) {
        const existing = readDevSessionJson<ContentReportRecord>(E2E_CONTENT_REPORTS_KEY) ?? [];
        submitDevReportFixture(existing, {
          reportId,
          reporterUid: actorUid,
          targetType,
          targetId,
          targetParentId,
          targetUid,
          reason,
          details: details.trim(),
        });
      } else {
        await submitContentReport({
          reportId,
          targetType,
          targetId,
          targetParentId,
          targetUid,
          reason,
          details: details.trim() || undefined,
        });
      }
      if (!mountedRef.current) return;
      notify({
        tone: 'success',
        title: 'Report submitted',
        message: 'Moderators will review this report under community safety guidelines.',
      });
      onSubmitted?.();
      onClose();
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error && err.message ? err.message : 'Unable to submit report right now.');
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  return (
    <DialogSurface
      variant="sheet"
      dismissOnBackdropClick={!submitting}
      maxWidthCss="30rem"
      titleId={`${baseId}-title`}
      onRequestClose={() => {
        if (!submitting) onClose();
      }}
      bodyClassName="p-4 sm:p-6 space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id={`${baseId}-title`} className="font-display font-semibold text-lg text-[var(--text-primary)]">
            Report {targetType}
          </h2>
          <p className="text-xs font-normal text-[var(--text-secondary)] truncate">
            {targetLabel}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!submitting) onClose();
          }}
          disabled={submitting}
          aria-label="Close report dialog"
          className="min-h-11 min-w-11 flex items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0 cursor-pointer"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor={`${baseId}-reason`} className="block text-xs font-semibold text-[var(--text-primary)]">
            Safety reason
          </label>
          <Select
            id={`${baseId}-reason`}
            ariaLabel="Report reason"
            value={reason}
            options={reasonOptions}
            onChange={(v) => setReason(v as ContentReportReason)}
            disabled={submitting}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${baseId}-details`} className="block text-xs font-semibold text-[var(--text-primary)]">
            Context for moderators (optional)
          </label>
          <textarea
            id={`${baseId}-details`}
            rows={3}
            maxLength={500}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            disabled={submitting}
            placeholder="Describe why this content should be reviewed"
            className="w-full rounded-xl border border-[var(--border-control)] bg-[var(--surface-inset)] px-3.5 py-2.5 text-sm font-normal text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400"
          />
        </div>

        {error && (
          <p role="alert" className="text-xs font-semibold text-red-700 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="min-h-11 px-4 rounded-xl border border-[var(--border-button)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] cursor-pointer disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
          >
            <Flag className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{submitting ? 'Submitting...' : 'Submit Report'}</span>
          </button>
        </div>
      </form>
    </DialogSurface>
  );
}
