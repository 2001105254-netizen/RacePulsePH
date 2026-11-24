import type { NativeRunFix } from './nativeRunTracking';

export interface DrainFlushBatch {
  incomingFixes: NativeRunFix[];
  minLastTimestampMs: number;
}

interface InFlightWakeDrain {
  generation: number;
  preDrainLastTs: number;
  takenOverByStop: boolean;
  promise: Promise<NativeRunFix[]>;
}

/**
 * Coordinates foreground wake drains and Pause/Finish pre-stop drains so a concurrent stop
 * never discards fixes already popped from Android's destructive `BUFFERED_FIXES` queue.
 */
export class BufferedFixCoordinator {
  private generation = 0;
  private draining = false;
  private queuedFixes: NativeRunFix[] = [];
  private inFlight: InFlightWakeDrain | null = null;

  isDraining(): boolean {
    return this.draining;
  }

  enqueueLiveFix(fix: NativeRunFix): void {
    this.queuedFixes.push(fix);
  }

  /** Resets drain state and drops stale queued fixes when starting, resuming, or discarding a run. */
  reset(): void {
    this.generation += 1;
    this.draining = false;
    this.inFlight = null;
    this.queuedFixes = [];
  }

  /**
   * Drains buffered native fixes on app wake/focus. Returns null if a drain is already active,
   * if `beginStopDrain` takes ownership mid-flight, or if `reset()` rotated the generation.
   */
  async drainForWake(
    fetchBuffered: () => Promise<NativeRunFix[]>,
    getLastRawTimestamp: () => number,
    onWarn?: (err: unknown) => void,
  ): Promise<DrainFlushBatch | null> {
    if (this.draining || this.inFlight) {
      return null;
    }

    const myGen = this.generation;
    const preDrainLastTs = getLastRawTimestamp();
    this.draining = true;

    const promise = (async () => {
      try {
        const fixes = await fetchBuffered();
        return Array.isArray(fixes) ? fixes : [];
      } catch (err) {
        onWarn?.(err);
        return [];
      }
    })();

    const entry: InFlightWakeDrain = {
      generation: myGen,
      preDrainLastTs,
      takenOverByStop: false,
      promise,
    };
    this.inFlight = entry;

    const buffered = await promise;
    if (this.generation !== myGen || entry.takenOverByStop || this.inFlight !== entry) {
      return null;
    }

    this.inFlight = null;
    this.draining = false;
    const queued = this.queuedFixes.splice(0);
    return {
      incomingFixes: [...buffered, ...queued],
      minLastTimestampMs: preDrainLastTs,
    };
  }

  /**
   * Coalesces with any active wake drain for this generation so screen-off fixes already popped
   * natively are handed off to Pause/Finish, then performs one final native drain before stop.
   */
  async beginStopDrain(
    fetchBuffered: () => Promise<NativeRunFix[]>,
    getLastRawTimestamp: () => number,
    onWarn?: (err: unknown) => void,
  ): Promise<{ bufferedFixes: NativeRunFix[]; minLastTimestampMs: number }> {
    const myGen = this.generation;
    this.draining = true;

    let minLastTimestampMs = getLastRawTimestamp();
    const collected: NativeRunFix[] = [];

    const existing = this.inFlight;
    if (existing && existing.generation === myGen) {
      existing.takenOverByStop = true;
      minLastTimestampMs = Math.min(minLastTimestampMs, existing.preDrainLastTs);
      const existingFixes = await existing.promise;
      if (this.generation !== myGen) {
        return { bufferedFixes: [], minLastTimestampMs };
      }
      if (this.inFlight === existing) {
        this.inFlight = null;
      }
      collected.push(...existingFixes);
    }

    try {
      const trailingFixes = await fetchBuffered();
      if (this.generation !== myGen) {
        return { bufferedFixes: [], minLastTimestampMs };
      }
      if (Array.isArray(trailingFixes) && trailingFixes.length > 0) {
        collected.push(...trailingFixes);
      }
    } catch (err) {
      onWarn?.(err);
    }

    return {
      bufferedFixes: collected,
      minLastTimestampMs,
    };
  }

  /** Clears `draining` and returns combined buffered and mid-drain live fixes ready to merge. */
  completeDrainAndTakeFixes(bufferedFixes: NativeRunFix[] = []): NativeRunFix[] {
    this.draining = false;
    const queued = this.queuedFixes.splice(0);
    if (bufferedFixes.length === 0) return queued;
    if (queued.length === 0) return bufferedFixes;
    return [...bufferedFixes, ...queued];
  }
}
