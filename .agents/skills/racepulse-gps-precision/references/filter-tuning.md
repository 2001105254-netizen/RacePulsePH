# GPS Filtering and Map-Matching Tuning Reference

## 1. Speed-Adaptive 2D Kalman Filter

Standard scalar Kalman filtering uses measurement variance `R = accuracyM^2` and process noise variance `Q = dtSec * sigma_a^2`. When a phone reports an accuracy of ±25m, `R = 625`, resulting in very low Kalman gain:

$$K = \frac{P}{P + R}$$

When $K < 0.05$, the filter severely discounts new measurements, causing the rendered marker to lag 20m to 50m behind a running athlete.

### Solution: Dynamic Velocity-Coupled Process Noise

Scale process noise dynamically with observed speed:

```typescript
const baseProcessNoise = 6.25; // m^2/s^2 (~2.5 m/s runner acceleration sigma)
const speedFactor = Math.max(1, (speedMps || 0) / 3.0);
const dynamicProcessNoiseM2 = dtSec * baseProcessNoise * speedFactor * speedFactor;
```

This ensures the filter stays agile and responsive during active running while remaining calm and jitter-free during aid station stops.

## 2. Terrain-Adaptive Accuracy Gating

Hardcoded accuracy cutoffs (such as rejecting all fixes with accuracy > 35m) fail in Philippine mountain and trail marathons (e.g., Mount Apo, Sierra Madre, Cordillera), where thick triple-canopy foliage attenuates satellite signal-to-noise ratios.

### Adaptive Multi-Tier Gate

- **High Quality (Tier 1):** Accuracy <= 15m. Fully trusted fix. Ingested directly into high-weight Kalman update.
- **Good Quality (Tier 2):** Accuracy between 16m and 35m. Standard runner tracking gate.
- **Coarse Mountain (Tier 3):** Accuracy between 36m and 65m. Accepted only if confirmed by forward displacement within maximum athlete speed (< 12 m/s). Tagged as `'coarse'`.
- **Multipath Reject (Tier 4):** Accuracy > 65m or sudden isolated >40m teleport jumps without confirmation. Rejected.

## 3. Course Corridor Map-Matching

When a runner is on an active course, raw GNSS readings should be projected to the verified race line:

1. Project raw fix `(lat, lon)` onto the nearest segment of `ProcessedRoute` using `projectCoordinateToRoute`.
2. Compute perpendicular cross-track error (`offsetMeters`).
3. If `offsetMeters <= 50m`, snap runner position to the route centerline for exact chainage, progress percentage, and elevation sampling.
4. If `offsetMeters > 50m`, render the runner off-course with visual warning telemetry (`X meters off course`).
