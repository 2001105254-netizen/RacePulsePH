import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, MapPinned, RefreshCw, RotateCcw } from 'lucide-react';
import { GpxRoute, loadGpxRoute, routeCenter } from '../lib/gpxRoute';

interface RouteMap3DProps {
  gpxUrl: string;
  raceName: string;
  fileName?: string;
  compact?: boolean;
}

interface ProjectedPoint {
  x: number;
  y: number;
  groundY: number;
}

const viewport = { width: 720, height: 360, padding: 36 };

function limitedPoints<T>(points: T[], maximum = 700): T[] {
  if (points.length <= maximum) return points;
  const stride = (points.length - 1) / (maximum - 1);
  return Array.from({ length: maximum }, (_, index) => points[Math.round(index * stride)]);
}

function projectRoute(route: GpxRoute, yaw: number, pitch: number): ProjectedPoint[] {
  const points = limitedPoints(route.points);
  const longitudeSpan = Math.max(route.bounds.east - route.bounds.west, 0.000001);
  const latitudeSpan = Math.max(route.bounds.north - route.bounds.south, 0.000001);
  const elevations = points.map((point) => point.elevation ?? 0);
  const minElevation = Math.min(...elevations);
  const elevationSpan = Math.max(Math.max(...elevations) - minElevation, 1);
  const yawRadians = (yaw * Math.PI) / 180;
  const pitchRadians = (pitch * Math.PI) / 180;
  const raw = points.map((point) => {
    const x = ((point.longitude - route.bounds.west) / longitudeSpan) - 0.5;
    const y = ((point.latitude - route.bounds.south) / latitudeSpan) - 0.5;
    const z = ((point.elevation ?? minElevation) - minElevation) / elevationSpan;
    const rotatedX = x * Math.cos(yawRadians) - y * Math.sin(yawRadians);
    const rotatedY = x * Math.sin(yawRadians) + y * Math.cos(yawRadians);
    return {
      x: rotatedX,
      y: rotatedY * Math.sin(pitchRadians) - z * Math.cos(pitchRadians) * 0.6,
      groundY: rotatedY * Math.sin(pitchRadians),
    };
  });
  const minX = Math.min(...raw.map((point) => point.x));
  const maxX = Math.max(...raw.map((point) => point.x));
  const minY = Math.min(...raw.map((point) => Math.min(point.y, point.groundY)));
  const maxY = Math.max(...raw.map((point) => Math.max(point.y, point.groundY)));
  const scale = Math.min(
    (viewport.width - viewport.padding * 2) / Math.max(maxX - minX, 0.000001),
    (viewport.height - viewport.padding * 2) / Math.max(maxY - minY, 0.000001),
  );
  return raw.map((point) => ({
    x: viewport.padding + (point.x - minX) * scale,
    y: viewport.height - viewport.padding - (point.y - minY) * scale,
    groundY: viewport.height - viewport.padding - (point.groundY - minY) * scale,
  }));
}

function RouteCanvas({ route, raceName }: { route: GpxRoute; raceName: string }) {
  const [yaw, setYaw] = useState(-28);
  const [pitch, setPitch] = useState(58);
  const dragStart = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const projected = useMemo(() => projectRoute(route, yaw, pitch), [route, yaw, pitch]);
  const path = projected.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const groundPath = projected.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.groundY.toFixed(1)}`).join(' ');
  const start = projected[0];
  const finish = projected[projected.length - 1];
  const center = routeCenter(route);
  const openStreetMapUrl = `https://www.openstreetmap.org/?mlat=${center.latitude.toFixed(6)}&mlon=${center.longitude.toFixed(6)}#map=14/${center.latitude.toFixed(6)}/${center.longitude.toFixed(6)}`;

  return (
    <div className="overflow-hidden rounded-[16px] border border-[var(--border-default)] bg-[var(--surface-inset)]">
      <svg
        viewBox={`0 0 ${viewport.width} ${viewport.height}`}
        className="block aspect-[2/1] w-full touch-none cursor-grab active:cursor-grabbing"
        role="img"
        aria-label={`3D route preview for ${raceName}. Drag to rotate the route.`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragStart.current = { x: event.clientX, y: event.clientY, yaw, pitch };
        }}
        onPointerMove={(event) => {
          if (!dragStart.current) return;
          setYaw(dragStart.current.yaw + (event.clientX - dragStart.current.x) * 0.45);
          setPitch(Math.max(24, Math.min(78, dragStart.current.pitch - (event.clientY - dragStart.current.y) * 0.18)));
        }}
        onPointerUp={() => { dragStart.current = null; }}
        onPointerCancel={() => { dragStart.current = null; }}
      >
        <defs>
          <linearGradient id="route-ground" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.2" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.04" />
          </linearGradient>
          <linearGradient id="route-line" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#ef4444" />
            <stop offset="1" stopColor="#fb7185" />
          </linearGradient>
        </defs>
        <rect width={viewport.width} height={viewport.height} fill="var(--surface-inset)" />
        <path d={groundPath} fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" opacity="0.08" />
        {projected.filter((_, index) => index > 0 && index % Math.max(1, Math.floor(projected.length / 18)) === 0).map((point, index) => (
          <line key={index} x1={point.x} x2={point.x} y1={point.y} y2={point.groundY} stroke="currentColor" strokeOpacity="0.16" strokeWidth="1.5" />
        ))}
        <path d={path} fill="none" stroke="var(--surface-page)" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" opacity="0.92" />
        <path d={path} fill="none" stroke="url(#route-line)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={start.x} cy={start.y} r="7" fill="#16a34a" stroke="var(--surface-page)" strokeWidth="3" />
        <circle cx={finish.x} cy={finish.y} r="7" fill="#dc2626" stroke="var(--surface-page)" strokeWidth="3" />
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-default)] px-3 py-2">
        <p className="text-[10px] text-[var(--text-secondary)]">Drag the route to rotate. Elevation comes from the GPX file.</p>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setYaw((current) => current - 20)} className="min-h-9 rounded-lg border border-[var(--border-default)] px-2.5 text-[10px] font-semibold text-[var(--text-primary)] hover:border-red-500/50 hover:text-red-500">Turn left</button>
          <button type="button" onClick={() => setYaw((current) => current + 20)} className="min-h-9 rounded-lg border border-[var(--border-default)] px-2.5 text-[10px] font-semibold text-[var(--text-primary)] hover:border-red-500/50 hover:text-red-500">Turn right</button>
          <button type="button" onClick={() => { setYaw(-28); setPitch(58); }} className="min-h-9 rounded-lg p-2 text-[var(--text-secondary)] hover:text-red-500" aria-label="Reset route view"><RotateCcw className="h-4 w-4" /></button>
          <a href={openStreetMapUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-[10px] font-semibold text-red-600 hover:bg-red-500/10 dark:text-red-400"><MapPinned className="h-3.5 w-3.5" /> Open location <ExternalLink className="h-3 w-3" /></a>
        </div>
      </div>
    </div>
  );
}

export default function RouteMap3D({ gpxUrl, raceName, fileName, compact = false }: RouteMap3DProps) {
  const [route, setRoute] = useState<GpxRoute | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setRoute(null);
    setError('');
    void loadGpxRoute(gpxUrl, controller.signal)
      .then((loaded) => setRoute(loaded))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'The route could not be displayed.');
      });
    return () => controller.abort();
  }, [gpxUrl]);

  return (
    <section className="rounded-[20px] border border-[var(--border-default)] bg-[var(--surface-panel)] p-4 sm:p-5" aria-label={`${raceName} route`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]"><MapPinned className="h-5 w-5 text-red-500" /> Race route</h3>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">{fileName || 'GPX route file'}</p>
        </div>
        {route && <div className="text-right text-xs text-[var(--text-secondary)]"><p><span className="font-semibold text-[var(--text-primary)]">{route.distanceKm.toFixed(1)} km</span> route distance</p><p className="mt-1"><span className="font-semibold text-[var(--text-primary)]">+{Math.round(route.elevationGainM)} m</span> ascent</p></div>}
      </div>
      <div className={compact ? 'mt-3' : 'mt-4'}>
        {route ? <RouteCanvas route={route} raceName={raceName} /> : error ? (
          <div className="rounded-[16px] border border-red-500/30 bg-red-500/10 px-4 py-5 text-sm text-red-600 dark:text-red-300">Route file is available, but the preview could not load. Download or replace the GPX file, then try again.</div>
        ) : (
          <div className="flex min-h-48 items-center justify-center gap-2 rounded-[16px] border border-[var(--border-default)] bg-[var(--surface-inset)] text-sm text-[var(--text-secondary)]"><RefreshCw className="h-4 w-4 animate-spin" /> Loading route preview</div>
        )}
      </div>
    </section>
  );
}
