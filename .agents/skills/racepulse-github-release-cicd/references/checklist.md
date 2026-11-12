# CI/CD release pipeline checklist

Standard release engineering workflow for RacePulsePH versioning, Android packaging (`RacePulsePH.apk` and `RacePulsePH.aab`), and automated GitHub Releases.

## 1. Per-commit versioning (`.githooks/pre-commit`)

1. Ensure `.gitattributes` keeps `.githooks/*` and shell scripts in LF line endings on Windows and Linux.
2. Run `npm run hooks:install` (`node scripts/setup-git-hooks.cjs`) once per clone (also triggered by `npm install` via `"prepare"`).
3. On each normal commit, `.githooks/pre-commit` executes `node scripts/release-version.cjs --auto --stage`:
   - If the author already bumped SemVer and `versionCode` relative to `HEAD` (for instance via `npm run version:minor` or `npm run version:major`), `--auto` preserves that bump and keeps all tracked files synced.
   - Otherwise, `--auto` increments SemVer patch (`X.Y.Z` to `X.Y.(Z+1)`) and Android `versionCode` (`N` to `N+1`), updates `package.json`, `package-lock.json`, `android/app/build.gradle`, and `rfid-station/RacePulseTimingStation.iss`, and stages them into the commit.
4. Set `SKIP_VERSION_BUMP=1` only when intentionally keeping the current version (for instance `git commit --amend`). Merges, rebases, and cherry-picks skip auto-bumping cleanly.

## 2. Standard Android release naming and signing (`scripts/build-android-release.cjs`)

1. `android/app/build.gradle` configures `base.archivesName = "RacePulsePH"`, forces release APK output `RacePulsePH.apk`, and copies release bundles to `RacePulsePH.aab`.
2. Required environment variables or Gradle properties for signed builds:
   - `KEYSTORE_PATH` (or `RELEASE_STORE_FILE`)
   - `KEYSTORE_PASSWORD` (or `RELEASE_STORE_PASSWORD`)
   - `KEYSTORE_ALIAS` (or `RELEASE_KEY_ALIAS`)
   - `KEYSTORE_ALIAS_PASSWORD` (or `RELEASE_KEY_PASSWORD`)
3. Run `npm run release:android -- --require-signed` to sync Capacitor assets, build both release binaries, verify signatures with `apksigner verify` and `jarsigner -verify`, stage assets under `release/android/`, and emit `SHA256SUMS.txt`.

## 3. GitHub Actions CI/CD (`.github/workflows/ci-cd-release.yml`)

Configure these repository secrets under GitHub Settings -> Secrets and variables -> Actions before triggering `android-release`:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded release `.jks` keystore file |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEYSTORE_ALIAS` | Signing key alias |
| `ANDROID_KEY_PASSWORD` | Key password for the signing alias |
| `GOOGLE_SERVICES_JSON_BASE64` | Base64-encoded `android/app/google-services.json` (optional if Firebase Google Services JSON is omitted) |

Release channels:

- **`main` push or dispatch:** creates/updates tag `v<version>` as the latest standard GitHub Release.
- **`QA` push or dispatch:** creates/updates tag `v<version>-qa.<versionCode>` as a GitHub pre-release so QA tags never collide when merged to `main`.
- Attached release assets on every release: `RacePulsePH.apk`, `RacePulsePH.aab`, `RacePulsePH.apk.sha256`, `RacePulsePH.aab.sha256`, and `SHA256SUMS.txt`.

