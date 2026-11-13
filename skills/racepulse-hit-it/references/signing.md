# Signing and release notes

## Two signing paths

- GitHub Release assets are signed in CI with the repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEYSTORE_ALIAS` and `ANDROID_KEY_PASSWORD`. Secrets cannot be read back.
- The local Play Store AAB is signed with `signing/racepulseph-release.jks`, created on 2026-11-14 with alias `racepulseph`. Credentials are in `signing/keystore.txt`.

These are different keys. Play Console must accept the local key as the upload key (first upload, or an upload key reset) before a locally signed AAB installs as an update. Verify against current Play Console docs.

## Back up

Copy `signing/` to private storage outside the repository. Losing the keystore means the upload key must be reset through Play support.

## Failure handling

- Lint, build or version check fails: stop, fix the source, restart the sequence.
- CI fails: read `gh run view --log-failed`, fix, push again. Do not retag manually.
- Missing `signing/keystore.txt`: stop and tell the user. Do not build an unsigned bundle for Play.
