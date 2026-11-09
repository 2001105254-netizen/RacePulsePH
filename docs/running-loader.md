# RacePulsePH running loader

The opening scene uses a real recorded running stride, projected into a small
athlete wearing the app's red. The athlete runs along a moving course,
crosses a timing mat only when the initial screen is usable, then fades into
the app. The charcoal scene transitions into the app's selected theme.

## What readiness means

- Session: waiting for Firebase's first authentication result.
- Account: waiting for the signed-in user's first profile result.
- Workspace: waiting for access settings and the mounted workspace shell.
- Public races: waiting for the first public race-list result, including usable
  cached results. An empty successful result is valid.
- Ready: the relevant initial screen is mounted. Live dashboard feeds and later
  navigation retain their own loading states.

No elapsed time or loop count is presented as a download percentage. Errors
never trigger a successful crossing. If readiness changes before the exit,
the loader returns to its waiting scene.

## Timing and recovery

The recorded full stride lasts 733.333 ms. Even an immediately ready app shows
one approach stride followed by one crossing stride and a 180 ms fade: about
1.65 seconds in total. Once a longer load is ready, only the crossing and fade
remain. The text says the app is ready while this finishing motion plays.

Travel, ground movement, and fade share one visible-time clock. Hidden tabs
pause the scene. Large frame gaps cannot skip the whole crossing. Motion
sensitive users receive a static scene and immediate dismissal on readiness.

Errors offer retry and an explicit action to open the app and inspect the issue.
After ten visible seconds, a pending load also offers these actions. That escape
does not declare success or activate the sensor. Keyboard and screen-reader
access to the underlying app is disabled only while the overlay is visible.
Static startup text is present in the HTML before the application code arrives.

## Cost and source

There is no additional runtime dependency, video, canvas, or 3D engine. Thirty-two
sampled poses are baked into a transparent 8-by-4 WebP sprite atlas (74,006 bytes).
The browser moves a single image with discrete transform offsets inside a clipped
viewport, preserving the captured stride timing. React only
updates when the stage, phase, recovery state, or motion preference changes;
scene travel and opacity are direct transform/opacity updates.

The original pose data is authoring input and is excluded from the runtime bundle.
The atlas is decoded before the first full stride starts. If it fails to load,
a small inline static athlete keeps the loader and recovery usable. The existing
small RP mark is reused. Original motion data, attribution, source
hashes, and the optional authoring tools are documented in
[`src/assets/RUNNER-MOTION.md`](../src/assets/RUNNER-MOTION.md).

## Validation

Browser checks cover pending, fast, ready, failed, and long-running loads;
readiness rollback; a simulated hidden tab during crossing; reduced motion;
moving recorded poses; a 320 px viewport; and exactly one automatic completion.
The production build passes. QA's existing type errors involving
`RunnerProfile.ageCategoryOverrideId` in `timing.ts` and `runnerReport.ts`
are outside this change.
