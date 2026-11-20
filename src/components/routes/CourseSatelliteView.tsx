import { useEffect, useRef, useState } from 'react';
import type { ProcessedRoute } from '../../lib/routes/geometry';

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
let mapsLibrary: Promise<google.maps.MapsLibrary> | undefined;
let configured = false;

function loadMaps() {
  return mapsLibrary ??= import('@googlemaps/js-api-loader').then(({ setOptions, importLibrary }) => {
    if (!configured) {
      setOptions({ key: apiKey, v: 'quarterly' });
      configured = true;
    }
    return importLibrary('maps');
  }).catch((error) => {
    mapsLibrary = undefined;
    throw error;
  });
}

export default function CourseSatelliteView({ route }: { route: ProcessedRoute }) {
  const container = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    if (!requested || !container.current) return;
    const element = container.current;
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    const lines: google.maps.Polyline[] = [];
    const mapsWindow = window as Window & { gm_authFailure?: () => void };
    const previousFailure = mapsWindow.gm_authFailure;
    mapsWindow.gm_authFailure = () => {
      setStatus('failed');
      previousFailure?.();
    };

    void loadMaps().then(({ Map, Polyline }) => {
      if (cancelled) return;
      const map = new Map(element, {
        center: { lat: route.points[0].latitude, lng: route.points[0].longitude },
        zoom: 14, mapTypeId: 'satellite', renderingType: google.maps.RenderingType.RASTER,
        streetViewControl: false, mapTypeControl: false, tilt: 0,
      });
      for (const segment of route.displaySegments) {
        const path = segment.map(({ latitude, longitude }) => ({ lat: latitude, lng: longitude }));
        for (const [strokeColor, strokeWeight] of [['#282828', 6], ['#ffde59', 3]] as const) {
          lines.push(new Polyline({ map, path, strokeColor, strokeWeight, clickable: false }));
        }
      }
      observer = new ResizeObserver(() => {
        if (!element.clientWidth || !element.clientHeight) return;
        map.fitBounds(route.bounds, 24);
        observer?.disconnect();
      });
      observer.observe(element);
      setStatus((current) => current === 'failed' ? current : 'ready');
    }).catch(() => { if (!cancelled) setStatus('failed'); });

    return () => {
      cancelled = true;
      mapsWindow.gm_authFailure = previousFailure;
      observer?.disconnect();
      for (const line of lines) line.setMap(null);
      element.replaceChildren();
    };
  }, [requested, route]);

  if (!apiKey) return null;
  return (
    <details className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)]"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (event.currentTarget.open) setRequested(true);
      }}>
      <summary className="scroll-mt-20 cursor-pointer px-4 py-3 text-sm font-semibold">Aerial course view</summary>
      {open && status !== 'ready' && (
        <p role="status" className="px-4 pb-3 text-sm">
          {status === 'loading' ? 'Loading satellite imagery…' : 'Satellite imagery is unavailable. Use the course map below.'}
        </p>
      )}
      <div ref={container} hidden={status === 'failed'} aria-label="Satellite map of the course"
        className="h-[340px] w-full sm:h-[400px] lg:h-[440px]" />
    </details>
  );
}
