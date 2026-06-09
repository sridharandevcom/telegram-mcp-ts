/**
 * Resilience layer.
 *
 * A generic retry-with-backoff + circuit-breaker wrapper used by the client
 * layers so every tool inherits reliability without bespoke error handling.
 *
 * Design goals:
 *  - Respect Telegram's own backpressure: when the API dictates a wait
 *    (Bot API 429 `retry_after`), honor it exactly rather than retry-storming.
 *  - Fail fast on non-retryable errors (4xx / auth) — retrying those just wastes
 *    time and can itself look abusive.
 *  - A circuit breaker stops hammering a failing endpoint (which is exactly the
 *    behavior that gets accounts flagged).
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** How a thrown error should be treated by the retry loop. */
export interface RetryDecision {
  retryable: boolean;
  /** If the server dictated a wait (ms), honor it instead of backoff. */
  retryAfterMs?: number;
}

export type Classifier = (err: unknown) => RetryDecision;

type BreakerState = "closed" | "open" | "half-open";

/**
 * Trips open after `threshold` consecutive failures and refuses calls for
 * `cooldownMs`, then allows a single half-open probe.
 */
export class CircuitBreaker {
  private failures = 0;
  private state: BreakerState = "closed";
  private openedAt = 0;

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000,
    private readonly label = "circuit",
  ) {}

  canRequest(): boolean {
    if (this.state === "open") {
      if (Date.now() - this.openedAt >= this.cooldownMs) {
        this.state = "half-open";
        return true;
      }
      return false;
    }
    return true;
  }

  onSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  onFailure(): void {
    this.failures += 1;
    if (this.state === "half-open" || this.failures >= this.threshold) {
      this.state = "open";
      this.openedAt = Date.now();
    }
  }

  get name(): string {
    return this.label;
  }
}

export interface WithResilienceOptions {
  label: string;
  classify: Classifier;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  breaker?: CircuitBreaker;
  /** Called with the wait (ms) whenever a server-dictated retry-after is honored. */
  onBackpressure?: (ms: number) => void;
}

/** Run `fn`, retrying transient failures with backoff and honoring backpressure. */
export async function withResilience<T>(
  fn: () => Promise<T>,
  opts: WithResilienceOptions,
): Promise<T> {
  const {
    label,
    classify,
    maxRetries = 3,
    baseDelayMs = 500,
    maxDelayMs = 8_000,
    breaker,
    onBackpressure,
  } = opts;

  if (breaker && !breaker.canRequest()) {
    throw new Error(
      `Circuit breaker open for "${label}" — refusing the call to avoid hammering ` +
        "Telegram after repeated failures. Wait a moment and try again.",
    );
  }

  let attempt = 0;
  for (;;) {
    try {
      const result = await fn();
      breaker?.onSuccess();
      return result;
    } catch (err) {
      const decision = classify(err);
      if (!decision.retryable || attempt >= maxRetries) {
        breaker?.onFailure();
        throw err;
      }

      let wait: number;
      if (decision.retryAfterMs !== undefined) {
        wait = decision.retryAfterMs;
        onBackpressure?.(wait);
      } else {
        const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
        wait = backoff + Math.random() * backoff * 0.25; // +0-25% jitter
      }

      attempt += 1;
      await sleep(wait);
    }
  }
}
