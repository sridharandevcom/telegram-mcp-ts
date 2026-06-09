/**
 * In-process rate limiting + adaptive anti-ban throttling.
 *
 * Telegram flags accounts that act too fast or in bursts. We throttle three ways:
 *   - a global minimum gap between any two API calls,
 *   - a per-key (per-chat / per-user) minimum gap,
 *   - small random jitter so traffic doesn't look metronome-regular, and
 *   - an adaptive PENALTY: when Telegram pushes back (FloodWait / 429), the limiter
 *     widens its gaps for a cool-down window, then recovers.
 *
 * Safe mode (default on) uses conservative intervals. It can be loosened with
 * TELEGRAM_SAFE_MODE=false for power users who accept more risk.
 */

import { getSafetyConfig } from "./config.js";

export interface RateLimiterOptions {
  globalMinIntervalMs?: number;
  perKeyMinIntervalMs?: number;
  /** Max random jitter (ms) added to a non-zero wait. */
  jitterMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class RateLimiter {
  private readonly globalMin: number;
  private readonly perKeyMin: number;
  private readonly jitterMs: number;
  private lastGlobal = 0;
  private readonly lastByKey = new Map<string, number>();
  private chain: Promise<void> = Promise.resolve();

  // Adaptive penalty (set by penalize() on backpressure).
  private penaltyExtraMs = 0;
  private penaltyUntil = 0;

  constructor(opts: RateLimiterOptions = {}) {
    this.globalMin = opts.globalMinIntervalMs ?? 1000;
    this.perKeyMin = opts.perKeyMinIntervalMs ?? 3000;
    this.jitterMs = opts.jitterMs ?? 250;
  }

  /** Wait until it's safe to act against `key` (e.g. a chat id). */
  async acquire(key = "global"): Promise<void> {
    const run = this.chain.then(() => this.waitFor(key));
    this.chain = run.catch(() => undefined);
    return run;
  }

  /**
   * Apply an adaptive penalty after Telegram pushes back: widen all gaps by
   * `extraMs` for the next `windowMs`. Called by the resilience layer on
   * FloodWait / 429.
   */
  penalize(extraMs: number, windowMs = 60_000): void {
    this.penaltyExtraMs = Math.max(this.penaltyExtraMs, extraMs);
    this.penaltyUntil = Math.max(this.penaltyUntil, Date.now() + windowMs);
  }

  private currentPenalty(now: number): number {
    if (now >= this.penaltyUntil) {
      this.penaltyExtraMs = 0;
      return 0;
    }
    return this.penaltyExtraMs;
  }

  private async waitFor(key: string): Promise<void> {
    const now = Date.now();
    const penalty = this.currentPenalty(now);

    const sinceGlobal = now - this.lastGlobal;
    const sinceKey = now - (this.lastByKey.get(key) ?? 0);

    const waitGlobal = Math.max(0, this.globalMin + penalty - sinceGlobal);
    const waitKey = Math.max(0, this.perKeyMin + penalty - sinceKey);
    let wait = Math.max(waitGlobal, waitKey);

    if (wait > 0) wait += Math.random() * this.jitterMs;
    if (wait > 0) await sleep(wait);

    const stamp = Date.now();
    this.lastGlobal = stamp;
    this.lastByKey.set(key, stamp);
  }
}

const { safeMode } = getSafetyConfig();

/** Shared limiter for MTProto tools. Conservative in safe mode. */
export const mtprotoLimiter = new RateLimiter(
  safeMode
    ? { globalMinIntervalMs: 1500, perKeyMinIntervalMs: 4000 }
    : { globalMinIntervalMs: 800, perKeyMinIntervalMs: 2000 },
);

/** Shared limiter for Bot API tools (bots tolerate higher rates than user accounts). */
export const botLimiter = new RateLimiter(
  safeMode
    ? { globalMinIntervalMs: 200, perKeyMinIntervalMs: 1500 }
    : { globalMinIntervalMs: 100, perKeyMinIntervalMs: 1000 },
);
