import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Flame,
  HardDrive,
  RefreshCw,
  Server,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { formatDateTime } from '../../lib/preciseTime';
import { fetchSystemTelemetry } from '../../lib/telemetry/client';
import {
  formatBytes,
  formatCompactCount,
  triggerPercent,
  triggerStatusLabel,
} from '../../lib/telemetry/formatters';
import type {
  SystemTelemetrySnapshot,
  TelemetryTriggerStatus,
} from '../../lib/telemetry/types';
import { RunnerQueueSkeleton } from '../runner/RunnerMobilePrimitives';
import { Button } from '../ui/button';

const STORAGE_BUCKET_LABELS: Readonly<Record<string, string>> = {
  'social-media': 'Social Photos & Videos',
  'chat-media': 'Private Chat Attachments',
  'run-tracks': 'GPS Run Telemetry JSON',
  'badge-assets': 'Badge Artwork',
  'club-assets': 'Club Logos & Covers',
  'race-assets': 'Race Posters, Bibs & Highlights',
  other: 'Other Objects',
};

const TRIGGER_BADGE_CLASSES: Record<TelemetryTriggerStatus, string> = {
  ok: 'bg-emerald-700 text-white border-emerald-700',
  watch: 'bg-amber-800 text-white border-amber-800',
  scale: 'bg-red-700 text-white border-red-700',
};

const TRIGGER_BAR_CLASSES: Record<TelemetryTriggerStatus, string> = {
  ok: 'bg-emerald-700 dark:bg-emerald-500',
  watch: 'bg-amber-700 dark:bg-amber-400',
  scale: 'bg-red-700 dark:bg-red-500',
};

export default function SystemTelemetryPanel({
  currentUserId,
}: {
  currentUserId?: string;
}) {
  const baseId = useId();
  const mountedRef = useRef(true);
  const [snapshot, setSnapshot] = useState<SystemTelemetrySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadSnapshot = useCallback(
    async (forceRefresh = false) => {
      if (forceRefresh) setRefreshing(true);
      else setLoading((prev) => prev || snapshot === null);
      setError('');
      try {
        const data = await fetchSystemTelemetry(currentUserId, forceRefresh);
        if (!mountedRef.current) return;
        setSnapshot(data);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(
          err instanceof Error && err.message
            ? err.message
            : 'Unable to load system telemetry right now.',
        );
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [currentUserId, snapshot],
  );

  useEffect(() => {
    void loadSnapshot(false);
    // Initial mount load only; manual refreshes call loadSnapshot(true).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  if (loading && !snapshot) {
    return (
      <div className="space-y-4 py-2">
        <RunnerQueueSkeleton rows={5} label="Loading system telemetry" />
      </div>
    );
  }

  const maxDailySessions = snapshot
    ? Math.max(1, ...snapshot.rollups.dailySeries.map((d) => d.uniqueSessions))
    : 1;

  return (
    <section aria-labelledby={`${baseId}-heading`} className="space-y-5 py-2">
      {/* Sticky Summary Header */}
      <header className="glass-panel p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id={`${baseId}-heading`}
              className="text-xl sm:text-2xl font-display font-semibold text-[var(--text-primary)] tracking-tight"
            >
              System Telemetry
            </h2>
            {snapshot && (
              <span
                className={`px-2.5 py-0.5 rounded-md border text-xs font-semibold ${
                  snapshot.monitoring.source === 'cloud_monitoring'
                    ? 'bg-emerald-700 text-white border-emerald-700'
                    : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)]'
                }`}
              >
                {snapshot.monitoring.source === 'cloud_monitoring'
                  ? 'Live GCP Monitoring'
                  : 'Firestore & Storage Mode'}
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
            {snapshot
              ? `Updated ${formatDateTime(snapshot.generatedAt)} (${snapshot.cache.cached ? `cached ${snapshot.cache.ageSeconds}s` : 'fresh snapshot'})`
              : 'Live active users, storage sizing, Firestore counts, and ADR-003 scaling headroom.'}
          </p>
        </div>

        <Button
          type="button"
          variant="secondary"
          disabled={refreshing}
          onClick={() => void loadSnapshot(true)}
          className="min-h-11 shrink-0"
        >
          <RefreshCw
            className={`w-4 h-4 shrink-0 ${refreshing ? 'motion-safe:animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span>{refreshing ? 'Refreshing...' : 'Refresh Now'}</span>
        </Button>
      </header>

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-2xl border border-red-600/35 bg-red-500/10 p-4 flex flex-wrap items-center justify-between gap-3"
        >
          <p className="text-xs sm:text-sm font-semibold text-red-800 dark:text-red-300">{error}</p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void loadSnapshot(true)}
            className="min-h-11"
          >
            Retry
          </Button>
        </div>
      )}

      {snapshot && (
        <>
          {/* 4 Headline KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <article className="glass-panel p-4 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[var(--text-secondary)]">
                <span>Online Now ({snapshot.onlineNow.windowMinutes}m)</span>
                <Users className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
              </div>
              <p className="font-mono text-2xl sm:text-3xl font-semibold text-[var(--text-primary)] tabular-nums">
                {snapshot.onlineNow.total}
              </p>
              <p className="text-xs text-[var(--text-secondary)] tabular-nums">
                Web {snapshot.onlineNow.byPlatform.web} · Android {snapshot.onlineNow.byPlatform.android} · iOS {snapshot.onlineNow.byPlatform.ios}
              </p>
            </article>

            <article className="glass-panel p-4 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[var(--text-secondary)]">
                <span>Active Today (PHT)</span>
                <Flame className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
              </div>
              <p className="font-mono text-2xl sm:text-3xl font-semibold text-[var(--text-primary)] tabular-nums">
                {formatCompactCount(snapshot.rollups.dauToday)}
              </p>
              <p className="text-xs text-[var(--text-secondary)] tabular-nums">
                7d {formatCompactCount(snapshot.rollups.wau7d)} · 30d {formatCompactCount(snapshot.rollups.mau30d)}
              </p>
            </article>

            <article className="glass-panel p-4 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[var(--text-secondary)]">
                <span>Cloud Storage</span>
                <HardDrive className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
              </div>
              <p className="font-mono text-2xl sm:text-3xl font-semibold text-[var(--text-primary)] tabular-nums">
                {formatBytes(snapshot.storage.totalBytes)}
              </p>
              <p className="text-xs text-[var(--text-secondary)] tabular-nums">
                {formatCompactCount(snapshot.storage.objectCount)} stored objects
              </p>
            </article>

            <article className="glass-panel p-4 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[var(--text-secondary)]">
                <span>Firestore Indexed</span>
                <Database className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
              </div>
              <p className="font-mono text-2xl sm:text-3xl font-semibold text-[var(--text-primary)] tabular-nums">
                {snapshot.firestore.indexedMb.toFixed(1)} MB
              </p>
              <p className="text-xs text-[var(--text-secondary)] tabular-nums">
                {formatCompactCount(snapshot.firestore.totalDocuments)} docs ({snapshot.firestore.rawMb.toFixed(1)} MB raw)
              </p>
            </article>
          </div>

          {/* ADR-003 Scaling & Carriage Gauges */}
          <section aria-labelledby={`${baseId}-adr-heading`} className="glass-panel p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3
                  id={`${baseId}-adr-heading`}
                  className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]"
                >
                  ADR-003 Carriage &amp; Scaling Triggers
                </h3>
                <p className="text-xs text-[var(--text-secondary)]">
                  Automated threshold bands: OK (&lt; 70%), Watch (&gt;= 70%), Scale (&gt;= 90%).
                </p>
              </div>
              {snapshot.monitoring.reason && (
                <p className="text-xs font-semibold text-[var(--text-secondary)]">
                  {snapshot.monitoring.reason}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {snapshot.triggers.map((gauge) => {
                const pct = triggerPercent(gauge.currentValue, gauge.thresholdValue);
                const barWidth = Math.min(100, Math.max(pct > 0 ? 3 : 0, Math.round(gauge.percent)));
                const StatusIcon =
                  gauge.status === 'scale'
                    ? ShieldAlert
                    : gauge.status === 'watch'
                      ? AlertTriangle
                      : CheckCircle2;

                return (
                  <div
                    key={gauge.id}
                    className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[var(--text-primary)]">
                          {gauge.label}
                        </p>
                        <p className="text-xs font-mono text-[var(--text-secondary)] tabular-nums mt-0.5">
                          {gauge.secondaryText
                            ? gauge.secondaryText
                            : `${formatCompactCount(gauge.currentValue)} / ${formatCompactCount(gauge.thresholdValue)} ${gauge.unit}`}
                        </p>
                      </div>

                      <span
                        className={`px-2.5 py-0.5 rounded-md border text-xs font-semibold inline-flex items-center gap-1 shrink-0 tabular-nums ${TRIGGER_BADGE_CLASSES[gauge.status]}`}
                      >
                        <StatusIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>{triggerStatusLabel(gauge.status)}</span>
                        <span>{gauge.percent}%</span>
                      </span>
                    </div>

                    <div
                      role="progressbar"
                      aria-label={gauge.label}
                      aria-valuenow={Math.min(100, Math.round(gauge.percent))}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="h-2.5 w-full rounded-full bg-[var(--surface-card)] border border-[var(--border-subtle)] overflow-hidden"
                    >
                      <div
                        className={`h-full rounded-full ${TRIGGER_BAR_CLASSES[gauge.status]}`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>

                    <p className="text-xs text-[var(--text-secondary)] leading-snug">
                      {gauge.recommendation}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 14-Day PHT Trend & Cloud Functions Health */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <section
              aria-labelledby={`${baseId}-trend-heading`}
              className="lg:col-span-2 glass-panel p-4 sm:p-5 space-y-4"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3
                    id={`${baseId}-trend-heading`}
                    className="font-display font-semibold text-base text-[var(--text-primary)]"
                  >
                    14-Day Active Sessions (Asia/Manila)
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Sharded anonymized daily sessions ({snapshot.rollups.heartbeatsToday} heartbeats today).
                  </p>
                </div>
                <Activity className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
              </div>

              <div
                aria-label="14-day daily active session bars"
                className="h-36 pt-2 px-1 flex items-end gap-1.5 border-b border-[var(--border-subtle)]"
              >
                {snapshot.rollups.dailySeries.map((point) => {
                  const pctHeight = Math.max(
                    6,
                    Math.round((point.uniqueSessions / maxDailySessions) * 100),
                  );
                  return (
                    <div
                      key={point.dayKey}
                      title={`${point.dayKey}: ${point.uniqueSessions} sessions`}
                      className="flex-1 min-w-0 h-full flex flex-col justify-end items-center gap-1"
                    >
                      <div
                        className="w-full max-w-[28px] rounded-t-md bg-red-700 dark:bg-red-500"
                        style={{ height: `${pctHeight}%` }}
                      />
                      <span className="font-mono text-xs text-[var(--text-secondary)] tabular-nums truncate max-w-full">
                        {point.dayKey.slice(8)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section
              aria-labelledby={`${baseId}-ops-heading`}
              className="glass-panel p-4 sm:p-5 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h3
                  id={`${baseId}-ops-heading`}
                  className="font-display font-semibold text-base text-[var(--text-primary)]"
                >
                  API &amp; Queues
                </h3>
                <Server className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
              </div>

              <dl className="divide-y divide-[var(--border-subtle)] text-xs">
                <div className="py-2 flex items-center justify-between gap-2">
                  <dt className="text-[var(--text-secondary)]">24h Functions Calls</dt>
                  <dd className="font-mono font-semibold text-[var(--text-primary)] tabular-nums">
                    {snapshot.monitoring.requests24h.toLocaleString()}
                  </dd>
                </div>
                <div className="py-2 flex items-center justify-between gap-2">
                  <dt className="text-[var(--text-secondary)]">Error Rate</dt>
                  <dd className="font-mono font-semibold text-[var(--text-primary)] tabular-nums">
                    {snapshot.monitoring.errorRatePct.toFixed(2)}%
                  </dd>
                </div>
                <div className="py-2 flex items-center justify-between gap-2">
                  <dt className="text-[var(--text-secondary)]">Peak Write Throughput</dt>
                  <dd className="font-mono font-semibold text-[var(--text-primary)] tabular-nums">
                    {snapshot.monitoring.peakWriteRps.toFixed(1)} RPS
                  </dd>
                </div>
                <div className="py-2 flex items-center justify-between gap-2">
                  <dt className="text-[var(--text-secondary)]">Open Safety Reports</dt>
                  <dd className="font-mono font-semibold text-[var(--text-primary)] tabular-nums">
                    {snapshot.moderation.openReports}
                  </dd>
                </div>
                <div className="py-2 flex items-center justify-between gap-2">
                  <dt className="text-[var(--text-secondary)]">Pending Club Requests</dt>
                  <dd className="font-mono font-semibold text-[var(--text-primary)] tabular-nums">
                    {snapshot.moderation.pendingClubRequests}
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          {/* Storage Buckets & Firestore Sizing */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section
              aria-labelledby={`${baseId}-storage-heading`}
              className="glass-panel p-4 sm:p-5 space-y-3"
            >
              <h3
                id={`${baseId}-storage-heading`}
                className="font-display font-semibold text-base text-[var(--text-primary)]"
              >
                Cloud Storage Sizing by Prefix
              </h3>
              <ul className="divide-y divide-[var(--border-subtle)]">
                {Object.entries(snapshot.storage.prefixes).map(([prefix, stat]) => {
                  const pct =
                    snapshot.storage.totalBytes > 0
                      ? Math.round((stat.bytes / snapshot.storage.totalBytes) * 100)
                      : 0;
                  return (
                    <li key={prefix} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[var(--text-primary)] truncate">
                          {STORAGE_BUCKET_LABELS[prefix] || prefix}
                        </p>
                        <p className="text-xs font-mono text-[var(--text-secondary)] truncate">
                          /{prefix} · {stat.objects.toLocaleString()} objects
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-mono font-semibold text-[var(--text-primary)] tabular-nums">
                          {formatBytes(stat.bytes)}
                        </p>
                        <p className="text-xs font-mono text-[var(--text-secondary)] tabular-nums">
                          {pct}%
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section
              aria-labelledby={`${baseId}-firestore-heading`}
              className="glass-panel p-4 sm:p-5 space-y-3"
            >
              <h3
                id={`${baseId}-firestore-heading`}
                className="font-display font-semibold text-base text-[var(--text-primary)]"
              >
                Firestore Collection Sizing
              </h3>
              <ul className="divide-y divide-[var(--border-subtle)]">
                {snapshot.firestore.collections.slice(0, 10).map((col) => (
                  <li key={col.collection} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-mono font-semibold text-[var(--text-primary)] truncate">
                        {col.collection}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)] tabular-nums">
                        {col.documents.toLocaleString()} documents
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-mono font-semibold text-[var(--text-primary)] tabular-nums">
                        {col.indexedMb.toFixed(2)} MB idx
                      </p>
                      <p className="text-xs font-mono text-[var(--text-secondary)] tabular-nums">
                        {col.rawMb.toFixed(2)} MB raw
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </section>
  );
}
