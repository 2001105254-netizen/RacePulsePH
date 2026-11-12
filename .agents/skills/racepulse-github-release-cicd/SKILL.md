---
name: racepulse-github-release-cicd
description: Automate RacePulsePH semantic versioning, commit hooks, always-RacePulsePH Android APK/AAB naming, GitHub Actions CI/CD, and standard GitHub Releases. Use when setting up CI/CD workflows, versioning hooks, or publishing app releases.
---

# RacePulsePH GitHub CI/CD and release pipeline

Maintain synchronized SemVer and Android `versionCode` bumps per commit, keep built APK/AAB artifacts named `RacePulsePH`, and publish standard releases via GitHub Actions.

Load with: `racepulse-release-engineering`, `capacitor-android-architect`. Rules upheld: `C-2`, `C-4`, `C-5`, `R-02`, `R-33`, `R-35`, `R-36`. Detail: [CI/CD release pipeline checklist](references/checklist.md).

## Checklist

| Check | Reason | Evidence |
| --- | --- | --- |
| Keep SemVer and `versionCode` synchronized across `package.json`, `package-lock.json`, `android/app/build.gradle`, and `rfid-station/RacePulseTimingStation.iss` | Prevents version drift between npm, Android APK/AAB upgrades, and release tags | Run `npm run version:check` and confirm exit `0` |
| Install tracked Git hooks via `core.hooksPath` pointing to `.githooks` | Automatically increments patch SemVer and `versionCode` on every normal commit | Run `git config --local --get core.hooksPath` and verify `.githooks` |
| Enforce `base.archivesName`, `outputFileName = "RacePulsePH.apk"`, and release bundle naming in `android/app/build.gradle` | Guarantees every local and CI release artifact is always named `RacePulsePH.apk` and `RacePulsePH.aab` | Inspect `android/app/build.gradle` and run `npm run release:android` |
| Fail the GitHub Actions release job if any Android signing secret is absent (`ANDROID_KEYSTORE_*`) | Prevents publishing unsigned APKs or mismatched certificates to GitHub Releases | Inspect `.github/workflows/ci-cd-release.yml` signing validation step |
| Verify signed `RacePulsePH.apk` with `apksigner` and `RacePulsePH.aab` with `jarsigner` before publishing SHA-256 checksums | Proves installability and integrity before tagging `vX.Y.Z` on GitHub Releases | Inspect `scripts/build-android-release.cjs` verification output and `SHA256SUMS.txt` |
| Publish standard `main` releases as `vX.Y.Z` (latest) and `QA` builds as `vX.Y.Z-qa.N` (prerelease) | Avoids tag collisions when promoting tested `QA` builds into `main` | Inspect tag computation in `.github/workflows/ci-cd-release.yml` |

## Stack mapping

- Commit automation lives in `.githooks/pre-commit`, `scripts/setup-git-hooks.cjs`, `scripts/release-version.cjs`, and `.gitattributes`.
- Android naming, signing, and verification live in `android/app/build.gradle`, `capacitor.config.ts`, and `scripts/build-android-release.cjs`.
- GitHub CI/CD and release publication live in `.github/workflows/ci-cd-release.yml`.

## Not covered

- Generated Firestore/RBAC rule compilation and Firebase rollout flags belong to `racepulse-release-engineering` and `racepulse-access-validation`.
- Native WebView insets, R8 tuning, and Capacitor plugin wiring belong to `capacitor-android-architect`.

## Verify

1. Run `npm run version:check`, `npm run lint`, `npm run build`, `node --test tests/release-version.test.cjs`, and `node .agents/skills/racepulse-skill-maker/scripts/validate-skill-library.cjs` and confirm exit `0`.
2. Verify CI workflow syntax and secret checklist in `.github/workflows/ci-cd-release.yml`, then report PASS/FAIL per check with the purpose log.

