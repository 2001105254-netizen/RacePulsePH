import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  persistentSingleTabManager,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithCredential,
  reauthenticateWithPopup,
  reauthenticateWithCredential,
  EmailAuthProvider,
  updatePassword,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { initFirebaseAppCheck } from './lib/botProtection';

// Configuration for the racepulseph Firebase project
const firebaseConfig = {
  apiKey: "AIzaSyBDJINSNOpvVOtichvPKWIKixWvxa5pI9s",
  authDomain: "racepulseph.firebaseapp.com",
  projectId: "racepulseph",
  storageBucket: "racepulseph.firebasestorage.app",
  messagingSenderId: "720035436658",
  appId: "1:720035436658:web:fb5ffae560bccb70208aeb"
};

const app = initializeApp(firebaseConfig);
initFirebaseAppCheck(app);

// Initialize Firestore on the default database with resilient persistent cache.
// Native Capacitor apps use persistentSingleTabManager({ forceOwnership: true }) to prevent
// multi-tab Web Locks hangs across Android activity pauses, resumes, and app restarts.
export const db = typeof window !== 'undefined'
  ? initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: Capacitor.isNativePlatform()
          ? persistentSingleTabManager({ forceOwnership: true })
          : persistentMultipleTabManager(),
      }),
    })
  : initializeFirestore(app, {});
export const storage = getStorage(app);
export const auth = getAuth(app);

// Auth setup - individual accounts for Admin / Organizer / Runner roles
if (typeof window !== 'undefined') {
  setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.warn('Firebase Auth persistence failed to configure:', err);
  });
}

export async function signUpWithEmail(email: string, password: string, displayName: string): Promise<User> {
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await updateProfile(credential.user, { displayName: displayName.trim() });
  return credential.user;
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  return credential.user;
}

export async function updateAccountDisplayName(displayName: string): Promise<void> {
  if (!auth.currentUser) throw new Error('You need to sign in again before updating your profile.');
  await updateProfile(auth.currentUser, { displayName: displayName.trim() });
}

/**
 * Returns true when the current Firebase user has an email/password provider attached.
 */
export function hasPasswordProvider(user: User | null = auth.currentUser): boolean {
  if (!user) return false;
  return user.providerData.some((provider) => provider.providerId === 'password');
}

/**
 * Reauthenticates the signed-in user with their current password and updates
 * their Firebase Auth password to the provided new password.
 */
export async function changeAccountPassword(currentPassword: string, newPassword: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.email) {
    throw new Error('You must be signed in with an email address to change your password.');
  }
  if (!currentPassword) {
    throw new Error('Please enter your current password.');
  }
  if (newPassword.length < 8 || newPassword.length > 128) {
    throw new Error('New password must be between 8 and 128 characters.');
  }
  if (!hasPasswordProvider(user)) {
    throw new Error('This account signs in with Google. Use Reset via Email Code to set a password.');
  }
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  try {
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
  } catch (err: unknown) {
    const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: unknown }).code ?? '') : '';
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials') {
      throw new Error('Current password is incorrect. Please try again or use Reset via Email Code.');
    }
    if (code === 'auth/weak-password') {
      throw new Error('New password is too weak. Use at least 8 characters.');
    }
    if (code === 'auth/too-many-requests') {
      throw new Error('Too many attempts. Please wait a moment or use Reset via Email Code.');
    }
    throw new Error(err instanceof Error && err.message ? err.message : 'Unable to update password right now.');
  }
}

const GOOGLE_WEB_CLIENT_ID = '720035436658-3e4k16l8op866qja6updrf2dlptg89t9.apps.googleusercontent.com';
export const googleProvider = new GoogleAuthProvider();
let socialLoginInitPromise: Promise<void> | null = null;

async function ensureNativeGoogleLogin(): Promise<void> {
  if (!socialLoginInitPromise) {
    socialLoginInitPromise = SocialLogin.initialize({
      google: {
        webClientId: GOOGLE_WEB_CLIENT_ID,
        mode: 'online',
        skipAuthOnlyAuthorizationAfterSignIn: true,
      },
    }).catch((err) => {
      socialLoginInitPromise = null;
      throw err;
    });
  }
  await socialLoginInitPromise;
}

/**
 * Obtains a Google OAuth ID token inside the app via Android Credential Manager
 * so Capacitor builds never hand authentication off to an external browser tab.
 */
async function getNativeGoogleAuthCredential() {
  await ensureNativeGoogleLogin();
  try {
    const response = await SocialLogin.login({
      provider: 'google',
      options: {
        style: 'standard',
      },
    });
    if (response.provider !== 'google' || response.result.responseType !== 'online' || !response.result.idToken) {
      throw new Error('Google sign-in did not return an ID token.');
    }
    return GoogleAuthProvider.credential(response.result.idToken);
  } catch (err: unknown) {
    const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: unknown }).code ?? '') : '';
    if (code === 'USER_CANCELLED') {
      const cancelErr = new Error('Google sign-in was cancelled.') as Error & { code: string };
      cancelErr.code = 'auth/popup-closed-by-user';
      throw cancelErr;
    }
    throw err;
  }
}

export async function signInWithGoogle(): Promise<User> {
  if (Capacitor.isNativePlatform()) {
    const credential = await getNativeGoogleAuthCredential();
    const userCredential = await signInWithCredential(auth, credential);
    return userCredential.user;
  }
  const credential = await signInWithPopup(auth, googleProvider);
  return credential.user;
}

export async function reauthenticateWithGoogle(user: User): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const credential = await getNativeGoogleAuthCredential();
    await reauthenticateWithCredential(user, credential);
    return;
  }
  await reauthenticateWithPopup(user, new GoogleAuthProvider());
}

export async function signOutUser(): Promise<void> {
  await firebaseSignOut(auth);
  if (Capacitor.isNativePlatform()) {
    await SocialLogin.logout({ provider: 'google' }).catch(() => {});
  }
}

// Error Handling Utilities required by firebase-integration skill
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: null,
      email: null,
      emailVerified: null,
      isAnonymous: null,
      tenantId: null,
      providerInfo: []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
