# Finish precision and close finishes

Finish, chip and gun elapsed times display six fractional seconds. All seven fractional digits supplied by the Windows bridge are retained for calculations and arrival ordering. Existing raw timestamps are recalculated automatically; previously published summaries must be republished by an authorized operator. Previously rounded data cannot recover lost precision.

Equal measured elapsed times share competition places (1, 1, 3), including age places, and require finish review. A different bib number never breaks a sporting tie. Close results are provisional in the presentation, organizer rankings, public feed and certificates.

In Live Rankings, an operator with timing correction permission can save a calibrated finish review window in milliseconds. Zero, the default, flags exact ties only and does not establish an accuracy claim. Measure the station against finish-line footage before setting a wider window. Review flags are advisory; camera evidence, adjudication recording and confirmed-place overrides are not yet integrated. Existing scan undo/re-entry remains available for correcting erroneous measurements; do not fabricate timestamps merely to break a tie.

Bridge events retain original UTC receipt timestamp, sequence number, monotonic counter/frequency, antenna and event ID. These are diagnostic receipt measurements, not hardware crossing timestamps. The app acknowledges events only after validation/local enqueue; storage failures are retried. Repeated delivery preserves server receipt time and uses a stable checkpoint read ID. The server retains all events within its existing 12-hour recovery window instead of discarding large bursts by count. Station changes deliberately start a new receipt window to avoid assigning previous sightings to the wrong checkpoint. Validation rejections still show operator feedback and are not retried automatically.

Deployment requires the updated web app/server and Firestore rules. Rebuild the Windows bridge/Timing Station with the vendor SDK DLLs to emit the additional diagnostics. Old bridge messages remain supported. The vendor DLLs are absent from this checkout, so the bridge build and actual reader accuracy must be verified with the device.

Hardware timestamps, continuous raw sightings before duplicate suppression, camera synchronization, video review and finish-order adjudication require a further integration with verified equipment capabilities. Six decimal places do not imply microsecond detection accuracy.
