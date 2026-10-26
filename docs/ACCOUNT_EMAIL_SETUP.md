# RacePulse account emails

Account creation now requires a six-digit email code before the app creates
the user profile or permits dashboard access. Existing unverified accounts
also verify their email on their next visit. Google accounts that already
have a verified email continue directly to profile setup or their dashboard.

Forgot password sends a branded code, verifies that code, then permits a new
password. Completing a reset revokes the account's refresh tokens. Password
reset does not mark an unverified account verified; that account still
completes signup verification when it signs in.

## Sender and private configuration

- Sender: **RacePulsePH <events@racepulseph.com>**.
- Delivery: Google Workspace/Gmail SMTP over TLS on port 465.
- Firebase function: `accountApi`, region `asia-southeast1`.
- `SMTP_USER` is a Firebase string parameter, defaulting to the sender above.
- `SMTP_APP_PASSWORD` and `AUTH_CODE_SECRET` are Firebase Secret Manager secrets.
- The private, Git-ignored `functions/.secret.local` file configures local
  Functions emulation and the secret upload script. It must never be committed,
  copied into browser configuration or displayed in logs.
  Firebase deployment excludes private configuration files, and the local
  Vite preview denies HTTP access to them.

`AUTH_CODE_SECRET` is a separate random server secret used to protect stored
codes and reset grants. Keep it stable across deployments. Rotating it
invalidates outstanding codes and grants.

## Enable in Firebase

### Test locally before deployment

```powershell
npm run dev:local
```

This starts the pinned Firebase CLI's Auth, Firestore and Functions emulators
using the **demo-racepulseph** project, then opens the local server at
`http://127.0.0.1:3000`. The emulator dashboard is at
`http://127.0.0.1:4000`. The first run downloads the emulator tooling and
requires Java 21 or newer. No Firebase login or cloud deployment is needed.

Local signup creates disposable accounts on this computer. Use a test
password, not your Gmail password. Verification and password reset use the
same account function and email templates as the deployed app; emails are
really delivered to the address you enter through the configured SMTP sender.
The SMTP app password and code secret stay in `functions/.secret.local`.
The launcher adds inert local payment-secret placeholders when missing so
emulator startup never tries to download cloud payment secrets.

This mode routes account requests through `/api/account` to local Functions
and connects the browser to local Auth and Firestore. Storage also points
locally but its emulator is not started by this account workflow, so uploads
are unavailable. Online checkout is disabled for local account testing.
The local server listens only on the loopback address. Account/database data
is temporary and resets when the emulators stop; received Gmail messages
remain in the recipient's mailbox.

Use **Create Account** to test the full flow, including automatic profile
creation after verification. Existing live accounts are separate from local
accounts even when you use the same email address. Stop with Ctrl+C.

Local delivery was checked on 27 October 2026 using a disposable emulator
account and real Google SMTP delivery. Signup reached the runner dashboard
after the received code was confirmed. Password recovery accepted the emailed
code, rejected mismatched passwords, invalidated the old password and allowed
sign-in with the replacement. Both messages included the embedded logo and
passed SPF/DKIM, but Gmail placed both in Spam. No live Firebase deployment
or live account changes were made during this check.

### Deploy when authorized

Use an account that can deploy to the `racepulseph` Firebase project. Cloud
Functions requires the Blaze plan and Secret Manager permissions. The SMTP
app password must belong to the sender mailbox above, with Google two-step
verification enabled.

From PowerShell in the project directory:

```powershell
npx --yes firebase-tools login
npm install --prefix functions
./scripts/configure-account-email.ps1
npm run build
npx --yes firebase-tools deploy --only functions:accountApi,firestore:rules,storage,hosting --project racepulseph
```

The setup script uploads the two secrets through temporary ignored files;
secret values are never passed as command-line arguments. If the system npm
or npx shim is broken, use `C:/Program Files/nodejs/npm.cmd` and
`C:/Program Files/nodejs/npx.cmd` respectively.

The SMTP sign-in can be checked without sending mail:

```powershell
node scripts/check-account-email.cjs
```

Deploy the app, function and rules together. The stricter rules require a
verified email for authenticated data access. Deploying only the browser or
only the rules can leave account creation blocked until the rest is deployed.

The browser uses this endpoint by default:

```text
https://asia-southeast1-racepulseph.cloudfunctions.net/accountApi
```

For another environment, override `VITE_ACCOUNT_API_URL` at build time.
Never prefix SMTP or code secrets with `VITE_`.

Optionally enable Firestore TTL on `expiresAt` for `accountChallenges`,
`accountResetGrants` and `accountRateLimits` to remove expired private records.
Expiry and attempt checks work independently of TTL cleanup.

## Verify after deployment

1. Create a runner account with a real mailbox. Confirm the personalized
   greeting, embedded RacePulse logo, large six-digit code and sign-off.
2. Check that the dashboard is inaccessible before code confirmation.
3. Try an incorrect code, request another after the cooldown and confirm
   that the previous code no longer works.
4. Confirm the latest code; profile creation should finish automatically.
   A taken username opens the prefilled profile form for correction.
5. Sign out, use **Forgot password?**, confirm the reset code and choose a
   new password. Check that the old password fails and the new one works.
6. Check the same reset flow through **Runner profile → Reset password**.

Codes expire in 10 minutes, allow five incorrect attempts and have a
60-second resend cooldown. Each address/purpose permits five sends per hour;
each IP permits 60 account service actions per hour. A reset code is exchanged
for a single-use reset grant that expires in 10 minutes. Neither codes nor
grants are stored in plaintext, and the browser cannot read their collections.

Run the automated security checks with:

```powershell
node --test tests/account-security.test.cjs
```

The backend dependency check has no remaining high-severity findings after
patching the email library and body parser. The existing Firebase dependency
tree still reports moderate findings involving `uuid`; resolving those
requires a separate Firebase SDK major-version upgrade and regression check.

For local visual inspection, the two email layouts can be generated without
SMTP or credentials:

```powershell
node scripts/preview-account-emails.cjs
```

Open `output/account-emails/verification.html` and `password-reset.html`.
These contain a fixed demonstration code, never an actual account code.
