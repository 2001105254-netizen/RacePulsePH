# GNSS and Geolocation Calibration Reference

## 1. Platform Positioning Providers

### Desktop Browsers (Windows, macOS, Linux)
Desktop operating systems typically lack dedicated GNSS/GPS baseband processors. The browser Geolocation API (`navigator.geolocation`) relies on:
- Wi-Fi Access Point BSSID mapping against Google or Apple location databases.
- Public IP address routing tables from internet service providers.

In the Philippines, major ISPs (PLDT, Globe Telecom, Converge ICT, DITO, Starlink) route traffic through regional centralized gateways. Desktop IP-based geolocation commonly places users in Metro Manila, Cebu, or hundreds of kilometers away from their actual physical location, often reporting artificial accuracy radii of ±25km to ±50km.

### Native Android via Capacitor
Capacitor applications running on mobile devices have direct access to Google Play Services `FusedLocationProviderClient`. This provider aggregates:
- Dual-frequency GNSS (GPS L1/L5, Galileo E1/E5a, GLONASS, BeiDou).
- Cellular cell-tower multilateration.
- Wi-Fi RTT (Round Trip Time) fine indoor positioning.
- Device inertial measurement units (accelerometer, gyroscope, barometer).

Under open sky, native GNSS provides sub-3 meter accuracy with real-time Doppler speed and true heading.

## 2. API Options Specification

When requesting high-accuracy live tracking:

```typescript
const GNSS_TRACKING_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 12000,
  maximumAge: 0, // Force fresh satellite epoch; never accept stale cached cell tower fixes
};
```

When falling back for quick initial map centering:

```typescript
const COARSE_FALLBACK_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 6000,
  maximumAge: 15000, // Accept reasonably recent fix for instant initial camera pan
};
```

## 3. Honest UI Status Conventions

- Never label an unverified map center coordinate as a "GPS pinpoint".
- If coordinates are derived from a manual user click or map center, label the state: `Manual map anchor (no GPS lock)`.
- If satellite lock fails on desktop, prompt the user with clear instructions to either drop a manual pin on the map or enter coordinates directly.
