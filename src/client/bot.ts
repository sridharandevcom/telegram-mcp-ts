/**
 * Bot API client wrapper with built-in resilience.
 *
 * Fully isolated from the MTProto client: talks to
 * https://api.telegram.org via fetch and shares nothing with gramjs.
 *
 * Every call is wrapped in the resilience layer: transient/5xx/network errors
 * retry with backoff; a 429 honors `retry_after` exactly and feeds the adaptive
 * rate-limiter penalty; 4xx/auth errors fail fast.
 */

import { getBotToken } from "../lib/config.js";
import { withResilience, CircuitBreaker, type RetryDecision } from "../lib/resilience.js";
import { botLimiter } from "../lib/ratelimit.js";

const API_BASE = "https://api.telegram.org";

/** Typed Bot API error carrying the HTTP-ish code and any dictated retry delay. */
export class BotApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: number,
    public readonly description: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(`Bot API ${method} failed: ${description} (code ${code})`);
    this.name = "BotApiError";
  }
}

interface BotApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

const botBreaker = new CircuitBreaker(5, 30_000, "bot-api");

function methodUrl(method: string): string {
  return `${API_BASE}/bot${getBotToken()}/${method}`;
}

/** Classify a Bot API / network failure for the retry loop. */
function classifyBotError(err: unknown): RetryDecision {
  if (err instanceof BotApiError) {
    if (err.code === 429) {
      return { retryable: true, retryAfterMs: (err.retryAfterSeconds ?? 1) * 1000 };
    }
    if (err.code >= 500) return { retryable: true };
    return { retryable: false }; // 4xx / auth — don't retry
  }
  // Network-level (fetch threw): transient, retry.
  return { retryable: true };
}

async function parseAndUnwrap<T>(res: Response, method: string): Promise<T> {
  const data = (await res.json()) as BotApiResponse<T>;
  if (!data.ok) {
    throw new BotApiError(
      method,
      data.error_code ?? res.status,
      data.description ?? "unknown error",
      data.parameters?.retry_after,
    );
  }
  return data.result as T;
}

/** Call a Bot API method with a JSON body. */
export async function callBot<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  opts: { timeoutMs?: number; retry?: boolean } = {},
): Promise<T> {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) body[k] = v;
  }

  const doFetch = async (): Promise<T> => {
    const signal = AbortSignal.timeout(opts.timeoutMs ?? 30_000);
    const res = await fetch(methodUrl(method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    return parseAndUnwrap<T>(res, method);
  };

  if (opts.retry === false) return doFetch();

  return withResilience(doFetch, {
    label: `bot:${method}`,
    classify: classifyBotError,
    breaker: botBreaker,
    onBackpressure: (ms) => botLimiter.penalize(ms),
  });
}

/** Call a Bot API method with multipart/form-data (for local file uploads). */
export async function callBotMultipart<T = unknown>(method: string, form: FormData): Promise<T> {
  const doFetch = async (): Promise<T> => {
    const res = await fetch(methodUrl(method), {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    return parseAndUnwrap<T>(res, method);
  };

  return withResilience(doFetch, {
    label: `bot:${method}`,
    classify: classifyBotError,
    breaker: botBreaker,
    onBackpressure: (ms) => botLimiter.penalize(ms),
  });
}

/** Build the download URL for a Bot API file_path returned by getFile. */
export function botFileDownloadUrl(filePath: string): string {
  return `${API_BASE}/file/bot${getBotToken()}/${filePath}`;
}

/** Normalize a chat reference for the Bot API: numeric string -> number, else as-is. */
export function normalizeChatId(value: string): number | string {
  const t = value.trim();
  return /^-?\d+$/.test(t) ? Number(t) : t;
}

/* ---- Update polling (for handle_callback) ---- */

let updateOffset = 0;

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface BotUpdate {
  update_id: number;
  callback_query?: any;
  message?: any;
  [key: string]: any;
}

/** Long-poll for updates. No retry wrapper — a long-poll timeout is normal. */
export async function getBotUpdates(opts: {
  timeoutSeconds: number;
  allowedUpdates?: string[];
}): Promise<BotUpdate[]> {
  const updates = await callBot<BotUpdate[]>(
    "getUpdates",
    { offset: updateOffset, timeout: opts.timeoutSeconds, allowed_updates: opts.allowedUpdates },
    { timeoutMs: (opts.timeoutSeconds + 10) * 1000, retry: false },
  );

  if (updates.length > 0) {
    updateOffset = updates[updates.length - 1]!.update_id + 1;
  }
  return updates;
}

/** Acknowledge a callback query (dismisses the button's loading state). */
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  await callBot("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}
