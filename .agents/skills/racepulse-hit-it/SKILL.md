---
name: racepulse-hit-it
description: Ship RacePulsePH in one pass: commit, merge to main, push, publish the GitHub Release, build the signed Play Store AAB from the local keystore file, and format Play Console release details. Use when the user chats "hit it".
---

# Hit it: ship to main, GitHub and Play Store

Trigger phrase: the user sends "hit it". Run the whole sequence without asking again, stop on the first failed gate, and report the failure.

Load with: `racepulse-github-release-cicd`. Rules upheld: `C-2`, `C-5`, `R-35`. Detail: [signing and release notes](references/signing.md).

## Checklist

| Check | Reason | Evidence |
| --- | --- | --- |
| Run `npm run lint`, `npm run build`, `npm run version:check` | A broken build must never reach main or the store | Exit `0` for each |
| Stage with `git add -A`, then confirm `git status` lists no `signing/`, `*.jks`, or `google-services.json` | Signing material and Firebase config stay local | Staged list has none of them |
| Commit on the current branch. The `.githooks/pre-commit` hook bumps SemVer and `versionCode` | Play Store rejects an AAB whose `versionCode` repeats | `npm run version:check` exit `0` after commit |
| Merge into `main` (fast-forward when possible) and `git push origin main`; also push the source branch | CI publishes only from `main` and `QA` pushes | `git log origin/main -1` matches local `main` |
| Watch the run with `gh run list --limit 1` and `gh run watch`. It builds, signs with the GitHub secrets, and publishes `vX.Y.Z` | GitHub Release is the public download source | `gh release view vX.Y.Z` lists `RacePulsePH.apk` and `RacePulsePH.aab` |
| Build the Play Store bundle locally with `npm run release:android -- --require-signed` | `scripts/build-android-release.cjs` reads `signing/keystore.txt` for the upload key | Exit `0`, output shows `PASS: AAB certificate SHA1 matches the Play upload key`, and `release/android/RacePulsePH.aab` exists |
| Print the AAB path, `versionName`, `versionCode` and SHA-256 | The user uploads this file in Play Console | Values copied from the build output |
| Output Play Console `Release details`: a `Release name` (1 to 50 characters, format `<versionName> (<versionCode>)` or `<versionName> (<versionCode>) - <short label>`) and `Release notes` wrapped in `<en-US>` and `</en-US>` tags summarizing verified shipped changes | The user pastes these directly into Play Console when uploading the AAB | `Release name` length is <= 50 characters and `<en-US>` block contains only verified shipped changes (`C-5`, `R-02`) |

## Play Console output format

Include this block at the end of every "hit it" response, using plain text without em dashes (`R-02`) and only verified changes shipped in the release (`C-5`):

```text
Release name (max 50 chars):
<versionName> (<versionCode>)

Release notes:
<en-US>
- <concise user-facing or verified release bullet>
</en-US>
```

## Stack mapping

- Credentials live in `signing/keystore.txt` (keys `KEYSTORE_PATH`, `KEYSTORE_ALIAS`, `KEYSTORE_PASSWORD`, `KEYSTORE_ALIAS_PASSWORD`). The folder is gitignored.
- The keystore file is `signing/racepulseph-release.jks`. Never print its passwords in chat output or commit messages.
- Version bump and naming: `scripts/release-version.cjs`, `android/app/build.gradle`.
- CI publish: `.github/workflows/ci-cd-release.yml`.

## Not covered

- Uploading to Play Console is manual. The agent only produces the signed AAB.
- Changing, regenerating or replacing the keystore or the GitHub signing secrets. The Play upload key stays fixed unless the user asks.
- Firestore rules, Functions, and Hosting deploys belong to `racepulse-release-engineering`.

## Verify

1. Confirm `git status` is clean, `origin/main` equals local `main`, the CI run concluded `success`, and the GitHub Release exists.
2. Confirm `apksigner` and `jarsigner` verification passed in the local build output.
3. Confirm the output includes AAB path, `versionName`, `versionCode`, SHA-256, `Release name` (<= 50 characters), and `<en-US>` `Release notes`.
4. Report PASS/FAIL per check with the evidence, then the purpose log.
