# Signing and release notes

## One key

The Play upload key is the original keystore, SHA1 `0F:9E:41:87:5A:37:C3:41:8E:24:23:9A:56:53:EF:F7:FC:C1:4D:07`. Its master copy is `C:\Users\patri\.android\racepulseph-release.jks` (plus a `.bak` beside it). Never modify or regenerate it.

- Local builds read `signing/keystore.txt`, which points to `signing/racepulseph-release.jks`, an unmodified copy of that original.
- GitHub CI signs with the repository secrets, which hold the same key.
- `scripts/build-android-release.cjs` compares the AAB certificate SHA1 with the Play upload key and fails on any mismatch, so a wrong-key AAB is never staged.
- `signing/unused-new-key.jks.bak` is a stray key generated on 2026-11-14. Never use it for Play.

## Back up

Copy `signing/` and the original in the `.android` folder to private storage outside the repository.

## Failure handling

- Lint, build or version check fails: stop, fix the source, restart the sequence.
- CI fails: read `gh run view --log-failed`, fix, push again. Do not retag manually.
- Missing `signing/keystore.txt`: stop and tell the user. Do not build an unsigned bundle for Play.
- SHA1 mismatch: stop. Run `node scripts/fetch-play-aab.cjs` to download the CI AAB, which applies the same check.
