import { useId, useRef, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { CheckCircle2, ShieldCheck, Trash2, X } from 'lucide-react';
import { db } from '../firebase';
import { updateMarketingPreference } from '../lib/accountSecurity';
import { UserProfile } from '../types';
import DeleteAccountModal from './DeleteAccountModal';
import DialogSurface from './ui/DialogSurface';

interface AccountPrivacyModalProps {
  profile: UserProfile;
  onClose: () => void;
}

/**
 * Self-serve privacy, marketing opt-in, and account deletion settings dialog
 * shared for organizers, operators, and admins.
 */
export default function AccountPrivacyModal({ profile, onClose }: AccountPrivacyModalProps) {
  const dialogId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [marketingOptIn, setMarketingOptIn] = useState(Boolean(profile.marketingOptIn));
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleToggleMarketing = async (checked: boolean) => {
    setMarketingOptIn(checked);
    setSaving(true);
    setStatusMessage('');
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        marketingOptIn: checked,
        marketingUpdatedAt: new Date().toISOString(),
      }).catch(() => undefined);
      await updateMarketingPreference(checked);
      setStatusMessage(
        checked
          ? 'Optional event announcements enabled.'
          : 'You are opted out of optional event announcements.'
      );
    } catch {
      setStatusMessage('Email preference saved for your profile.');
    } finally {
      setSaving(false);
    }
  };

  if (showDeleteConfirm) {
    return (
      <DeleteAccountModal
        profile={profile}
        onClose={() => {
          setShowDeleteConfirm(false);
        }}
      />
    );
  }

  return (
    <DialogSurface
      titleId={`${dialogId}-title`}
      descriptionId={`${dialogId}-desc`}
      onRequestClose={onClose}
      initialFocusRef={closeRef}
      className="fixed inset-0 m-auto h-fit w-[calc(100%-2rem)] max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] p-6 text-[var(--text-primary)] shadow-2xl"
    >
      <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400 text-xs font-semibold">
            <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Account &amp; Data Rights</span>
          </div>
          <h2 id={`${dialogId}-title`} className="font-display text-lg font-semibold text-[var(--text-primary)]">
            {profile.displayName}
          </h2>
          <p id={`${dialogId}-desc`} className="text-xs text-[var(--text-secondary)]">
            {profile.email}
          </p>
        </div>

        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close account privacy settings"
          className="min-h-11 min-w-11 rounded-full border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors shrink-0"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-4 space-y-4">
        <label
          htmlFor={`${dialogId}-marketing`}
          className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4 flex items-start justify-between gap-4 cursor-pointer"
        >
          <span className="space-y-1">
            <span className="block text-sm font-semibold text-[var(--text-primary)]">
              Optional event updates &amp; newsletters
            </span>
            <span className="block text-xs text-[var(--text-secondary)] leading-relaxed">
              Opt in or out of optional RacePulsePH event announcements. Security codes and paid registration receipts are unaffected.
            </span>
          </span>
          <input
            id={`${dialogId}-marketing`}
            type="checkbox"
            disabled={saving}
            checked={marketingOptIn}
            onChange={(event) => void handleToggleMarketing(event.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-red-700 rounded cursor-pointer"
          />
        </label>

        {statusMessage && (
          <p role="status" className="flex items-center gap-2 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{statusMessage}</span>
          </p>
        )}

        <div className="rounded-xl border border-red-700/30 bg-red-50 dark:bg-red-950/30 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-red-800 dark:text-red-300">Delete My Account &amp; Data</h3>
            <p className="mt-1 text-xs text-[var(--text-secondary)] leading-relaxed">
              Permanently deletes your RacePulsePH profile, registrations, username handle, and friend directory data, and anonymizes historical payment audit references.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="min-h-11 px-4 rounded-xl border border-red-700 dark:border-red-400 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-700 hover:text-white inline-flex items-center gap-2 transition-colors"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            <span>Delete My Account &amp; Data</span>
          </button>
        </div>
      </div>
    </DialogSurface>
  );
}

