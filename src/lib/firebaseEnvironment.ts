// Local testing always uses a demo project, which has no live Firebase resources.
// The explicit flag prevents ordinary development from silently switching data.
export const useFirebaseEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';
export const localFirebaseProjectId = 'demo-racepulseph';

if (useFirebaseEmulators && typeof window !== 'undefined' && !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
  throw new Error('Firebase local test mode is only available on this computer.');
}
