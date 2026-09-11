// This is not a secret; Firestore rules independently enforce the same
// address. Keeping it in one place lets the app present a safe one-time claim
// screen for the account chosen by the RacePulsePH owner.
export const SUPER_ADMIN_EMAIL = 'kiahzeh@gmail.com';

export function isSuperAdminEmail(email?: string | null): boolean {
  return (email || '').trim().toLowerCase() === SUPER_ADMIN_EMAIL;
}
