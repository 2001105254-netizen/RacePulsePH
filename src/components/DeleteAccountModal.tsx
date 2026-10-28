import { useMemo, useState } from 'react';
import { EmailAuthProvider, GoogleAuthProvider, deleteUser, reauthenticateWithCredential, reauthenticateWithPopup } from 'firebase/auth';
import { collection, doc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';
import { auth, db } from '../firebase';
import { UserProfile } from '../types';

interface DeleteAccountModalProps {
  profile: UserProfile;
  onClose: () => void;
}

/**
 * Apple requires an in-app path for a person to delete the account they made.
 * We re-authenticate first, remove the person's profile / race registrations /
 * username directory entry, then remove their Firebase Authentication login.
 * Event and timing records stay intact so an organizer deleting an account
 * cannot erase an event or another runner's published result.
 */
export default function DeleteAccountModal({ profile, onClose }: DeleteAccountModalProps) {
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const user = auth.currentUser;
  const usesPassword = useMemo(() => user?.providerData.some((provider) => provider.providerId === 'password') ?? false, [user]);

  const handleDelete = async () => {
    if (profile.role === 'superadmin') { setError('Ask another Super Admin to change your role before deleting this account.'); return; }
    if (!user || user.uid !== profile.uid) {
      setError('Your session has expired. Please sign in again.');
      return;
    }
    if (confirmation.trim().toUpperCase() !== 'DELETE') {
      setError('Type DELETE to confirm this permanent action.');
      return;
    }
    if (usesPassword && !password) {
      setError('Enter your current password to continue.');
      return;
    }

    setDeleting(true);
    setError('');
    try {
      // Firebase requires a recent sign-in for deleting an authentication account.
      if (usesPassword) {
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(profile.email, password));
      } else {
        await reauthenticateWithPopup(user, new GoogleAuthProvider());
      }

      const registrations = await getDocs(query(collection(db, 'runners'), where('uid', '==', profile.uid)));
      const refs = registrations.docs.map((registration) => registration.ref);

      // Delete registrations in small batches; an account can have more than
      // Firestore's 500-write batch limit across many past races.
      for (let index = 0; index < refs.length; index += 450) {
        const batch = writeBatch(db);
        refs.slice(index, index + 450).forEach((ref) => batch.delete(ref));
        await batch.commit();
      }

      // The username index is removed with the profile so the deleted handle
      // becomes available again and cannot point at a non-existent account.
      const finalBatch = writeBatch(db);
      finalBatch.delete(doc(db, 'users', profile.uid));
      if (profile.username) finalBatch.delete(doc(db, 'usernameIndex', profile.username));
      await finalBatch.commit();

      await deleteUser(user);
      // deleteUser signs the person out; App's auth listener returns to the landing page.
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/wrong-password') setError('Incorrect password. Please try again.');
      else if (code === 'auth/requires-recent-login') setError('Please sign out, sign in again, then retry account deletion.');
      else if (code === 'auth/popup-closed-by-user') setError('Google confirmation was closed. Your account was not deleted.');
      else setError(err?.message || 'Could not delete this account. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn" role="dialog" aria-modal="true" aria-labelledby="delete-account-title">
      <div className="glass-panel w-full max-w-md p-6 space-y-5 relative border border-red-500/35">
        <button onClick={onClose} disabled={deleting} className="absolute right-4 top-4 glass-inset p-2 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50" aria-label="Close delete account dialog">
          <X className="w-4 h-4" />
        </button>

        <div className="pr-8">
          <div className="w-10 h-10 rounded-full bg-red-500/15 text-red-500 flex items-center justify-center mb-3"><AlertTriangle className="w-5 h-5" /></div>
          <h2 id="delete-account-title" className="font-display font-black text-xl uppercase text-[var(--text-primary)]">Delete account</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-2 leading-relaxed">This permanently deletes your RacePulse sign-in, profile, and race registrations. This cannot be undone.</p>
        </div>

        {profile.role === 'organizer' && (
          <div className="rounded-[var(--radius-control)] border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-xs text-amber-200 leading-relaxed">
            Published races and recorded timing results are retained so participants' official results stay available. You will no longer be able to manage them after deletion.
          </div>
        )}

        {usesPassword ? (
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Current password</label>
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={deleting} className="w-full glass-inset px-4 py-3 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" />
          </div>
        ) : (
          <p className="text-xs text-[var(--text-secondary)] glass-inset px-3 py-2.5">You will confirm this with your Google account in the next step.</p>
        )}

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Type <span className="text-red-500">DELETE</span> to confirm</label>
          <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={deleting} autoCapitalize="characters" className="w-full glass-inset px-4 py-3 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-red-500/50" placeholder="DELETE" />
        </div>

        {error && <p className="text-xs font-semibold text-red-500">⚠️ {error}</p>}

        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <button type="button" onClick={onClose} disabled={deleting} className="flex-1 py-3 rounded-[var(--radius-control)] border border-[var(--border-default)] text-xs font-black uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50">Cancel</button>
          <button type="button" onClick={() => void handleDelete()} disabled={deleting} className="flex-1 py-3 rounded-[var(--radius-control)] bg-red-600 hover:bg-red-500 text-white text-xs font-black uppercase tracking-wider flex justify-center items-center gap-2 disabled:opacity-60">
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete permanently
          </button>
        </div>
      </div>
    </div>
  );
}
