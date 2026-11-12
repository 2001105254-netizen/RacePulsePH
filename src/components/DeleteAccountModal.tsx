import React, { useId, useRef, useState } from 'react';
import {
  EmailAuthProvider,
  deleteUser,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, googleProvider, signOutUser } from '../firebase';
import { deleteMyAccountAndData } from '../lib/accountSecurity';
import { UserProfile } from '../types';
import { AlertTriangle, RefreshCw, ShieldAlert, X } from 'lucide-react';
import DialogSurface from './ui/DialogSurface';

interface DeleteAccountModalProps {
  profile: UserProfile;
  onClose: () => void;
}

/** Fallback client-side purge for local dev emulators when Cloud Functions endpoint is unreachable. */
async function clientFallbackPurge(profile: UserProfile): Promise<void> {
  const uid = profile.uid;
  const user = auth.currentUser;
  if (!user || user.uid !== uid) throw new Error('You are not signed in.');

  const batch = writeBatch(db);
  const runnersSnap = await getDocs(query(collection(db, 'runners'), where('uid', '==', uid)));
  runnersSnap.forEach((docSnap) => batch.delete(docSnap.ref));

  const claimsSnap = await getDocs(query(collection(db, 'runnerClaims'), where('uid', '==', uid)));
  claimsSnap.forEach((docSnap) => batch.delete(docSnap.ref));

  if (profile.username) {
    batch.delete(doc(db, 'friendDirectory', profile.username));
    batch.delete(doc(db, 'usernameIndex', profile.username));
  }
  batch.delete(doc(db, 'friendProfiles', uid));
  batch.delete(doc(db, 'friendActivities', uid));
  batch.delete(doc(db, 'users', uid));
  await batch.commit();
  await deleteUser(user);
}

/**
 * Self-serve account deletion and data purge/anonymization confirmation dialog.
 */
export default function DeleteAccountModal({ profile, onClose }: DeleteAccountModalProps) {
  const user = auth.currentUser;
  const usesPassword = Boolean(user?.providerData.some((provider) => provider.providerId === 'password'));
  const usesGoogle = Boolean(user?.providerData.some((provider) => provider.providerId === 'google.com'));
  const dialogId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const canConfirmText = confirmation.trim().toUpperCase() === 'DELETE';

  const handleDelete = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;
    if (!canConfirmText) {
      setError('Type DELETE in the confirmation box to proceed.');
      return;
    }
    if (usesPassword && !password) {
      setError('Enter your current password to verify your identity.');
      return;
    }

    setError('');
    setDeleting(true);
    try {
      if (usesPassword && user.email) {
        const credential = EmailAuthProvider.credential(user.email, password);
        await reauthenticateWithCredential(user, credential);
      } else if (usesGoogle) {
        await reauthenticateWithPopup(user, googleProvider);
      }

      try {
        await deleteMyAccountAndData();
      } catch (apiError: any) {
        if (apiError?.status === 401 || apiError?.status === 400) {
          throw apiError;
        }
        await clientFallbackPurge(profile);
      }

      try {
        await signOutUser();
      } catch {
        // User record may already be deleted.
      }
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError('That password is incorrect. Please check and try again.');
      } else if (code === 'auth/requires-recent-login') {
        setError('Please sign in again before deleting your account.');
      } else if (code === 'auth/popup-closed-by-user') {
        setError('Google verification was closed before confirming.');
      } else {
        setError(err?.message || 'Could not delete your account right now.');
      }
      setDeleting(false);
    }
  };

  return (
    <DialogSurface
      alert
      titleId={`${dialogId}-title`}
      descriptionId={`${dialogId}-desc`}
      onRequestClose={() => {
        if (!deleting) onClose();
      }}
      initialFocusRef={closeButtonRef}
      className="fixed inset-0 m-auto h-fit w-[calc(100%-2rem)] max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl border border-red-700/40 bg-[var(--surface-card)] p-6 text-[var(--text-primary)] shadow-2xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="w-11 h-11 rounded-full bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-400 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5" aria-hidden="true" />
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          disabled={deleting}
          aria-label="Close delete account dialog"
          className="min-h-11 min-w-11 rounded-full border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center disabled:opacity-50"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <h2 id={`${dialogId}-title`} className="mt-4 font-display text-xl font-semibold text-[var(--text-primary)]">
        Delete My Account &amp; Data
      </h2>
      <p id={`${dialogId}-desc`} className="mt-2 text-xs text-[var(--text-secondary)] leading-relaxed">
        This permanently deletes your RacePulsePH login ({profile.email}), personal profile, active race registrations, username handle, and friend directory records. Historical payment accounting records are anonymized so no personal contact data remains.
      </p>

      {profile.role === 'organizer' && (
        <div className="mt-4 rounded-xl border border-amber-700/40 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-950 dark:text-amber-200 flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-800 dark:text-amber-300" aria-hidden="true" />
          <span>
            Deleting an organizer account removes your staff access and profile immediately while keeping published public race timing logs intact.
          </span>
        </div>
      )}

      <form onSubmit={handleDelete} className="mt-4 space-y-4">
        {usesPassword && (
          <div>
            <label
              htmlFor={`${dialogId}-password`}
              className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5"
            >
              Confirm current password
            </label>
            <input
              id={`${dialogId}-password`}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={deleting}
              className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-4 py-2 text-sm text-[var(--text-primary)]"
            />
          </div>
        )}

        <div>
          <label
            htmlFor={`${dialogId}-confirm`}
            className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5"
          >
            Type <span className="font-mono text-red-700 dark:text-red-400">DELETE</span> to confirm permanent removal
          </label>
          <input
            id={`${dialogId}-confirm`}
            type="text"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={deleting}
            autoCapitalize="characters"
            placeholder="DELETE"
            className="w-full min-h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-4 py-2 text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
          />
        </div>

        {error && (
          <p role="alert" className="text-xs font-semibold text-red-700 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="min-h-11 px-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={deleting || !canConfirmText}
            className="min-h-11 px-4 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deleting && <RefreshCw className="w-4 h-4 motion-safe:animate-spin" aria-hidden="true" />}
            <span>{deleting ? 'Deleting account...' : 'Permanently Delete Account'}</span>
          </button>
        </div>
      </form>
    </DialogSurface>
  );
}
