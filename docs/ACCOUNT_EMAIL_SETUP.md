# RacePulse account emails

Account creation now requires a six-digit email code before the app creates
the user profile or permits dashboard access. Existing unverified accounts
also verify their email on their next visit. Google accounts that already
have a verified email continue directly to profile setup or their dashboard.

For sender authentication, the missing DMARC DNS record and Gmail placement,
see [Email deliverability](EMAIL_DELIVERABILITY.md). The email uses the public
HTTPS brand mark and a visible text wordmark so its identity survives image
blocking and HTML-only mail previews.

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
- The private, Git-ignored `functions/.secret.local` file supplies the secret
  upload script. It must never be committed,
  copied into browser configuration or displayed in logs.
  Firebase deployment excludes private configuration files, and the local
  Vite preview denies HTTP access to them.

`AUTH_CODE_SECRET` is a separate random server secret used to protect stored
codes and reset grants. Keep it stable across deployments. Rotating it
invalidates outstanding codes and grants.

## Enable in Firebase

The app always uses real Firebase authentication, including Google's real
account chooser for **Continue with Google**. No demo accounts, authentication
emulator, or local account-service substitute is enabled by the app.

Use an account that can deploy to the `racepulseph` Firebase project. Cloud
Functions requires the Blaze plan and Secret Manager permissions. The SMTP
app password must belong to the sender mailbox above, with Google two-step
verification enabled.

The Functions runtime is Node.js 22. Keep `firebase.json`,
`functions/package.json` and its lockfile aligned when changing the runtime.

From PowerShell in the project directory:

```powershell
npx --yes firebase-tools login
npm install --prefix functions
./scripts/configure-account-email.ps1
npm run build
./scripts/deploy-account-email.ps1
npx --yes firebase-tools deploy --only firestore:rules,storage,hosting --project racepulseph
```

For a release, deploy `functions:accountApi` successfully first, then publish
the updated Firestore/Storage rules and Hosting build. This avoids enforcing
verification before the email endpoint is available.

The email deployment script packages only the account service exports in a
temporary ignored directory. Firebase otherwise validates the unrelated
PayMongo secrets even when only `accountApi` is selected. It copies the exact
account source and dependency lockfile, without credentials or test files.

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
