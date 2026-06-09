/**
 * gramjs (MTProto) client wrapper.
 *
 * Provides a single lazily-connected TelegramClient for the user-account mode.
 * Tools call `getMtprotoClient()` and never construct a client themselves, so
 * connection/session handling lives in exactly one place.
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Logger } from "telegram/extensions/index.js";
import { LogLevel } from "telegram/extensions/Logger.js";
import { getMtprotoConfig, getSafetyConfig, type MtprotoConfig } from "../lib/config.js";

let clientPromise: Promise<TelegramClient> | null = null;

/**
 * Build a TelegramClient from explicit config. Used by the auth CLI (which needs
 * to control the session) and internally by getMtprotoClient.
 *
 * Note: gramjs logs to stdout by default, which would corrupt the MCP stdio
 * JSON-RPC stream. We force the logger to stderr-only ERROR level.
 */
export function createMtprotoClient(config: MtprotoConfig): TelegramClient {
  const session = new StringSession(config.session);
  const { safeMode } = getSafetyConfig();
  const client = new TelegramClient(session, config.apiId, config.apiHash, {
    connectionRetries: 5,
    retryDelay: 1000,
    requestRetries: 3,
    // Auto-reconnect on dropped connections (no crash on connection loss).
    autoReconnect: true,
    // Anti-ban: when Telegram returns FLOOD_WAIT below this many
    // seconds, gramjs sleeps and retries automatically instead of erroring —
    // honoring the server's backpressure. Higher ceiling in safe mode.
    floodSleepThreshold: safeMode ? 120 : 60,
    // Keep gramjs quiet so it never writes to stdout (the MCP transport).
    baseLogger: new Logger(LogLevel.ERROR),
  });
  return client;
}

/**
 * Get a connected, authorized client for tool use. Connects once and reuses the
 * connection for the life of the process. Throws if the session is missing or
 * not authorized — callers wrap this via runTool so the client sees a clean error.
 */
export async function getMtprotoClient(): Promise<TelegramClient> {
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const config = getMtprotoConfig(/* requireSession */ true);
    const client = createMtprotoClient(config);
    await client.connect();

    const authorized = await client.isUserAuthorized();
    if (!authorized) {
      await client.disconnect().catch(() => undefined);
      throw new Error(
        "TELEGRAM_SESSION is set but not authorized (expired or revoked). " +
          "Re-run `npm run auth login` to create a fresh session.",
      );
    }
    return client;
  })();

  try {
    return await clientPromise;
  } catch (err) {
    // Reset so a later call can retry rather than caching the failure forever.
    clientPromise = null;
    throw err;
  }
}

/** Disconnect the shared client if one was created (used on shutdown). */
export async function disconnectMtprotoClient(): Promise<void> {
  if (!clientPromise) return;
  try {
    const client = await clientPromise;
    await client.disconnect();
  } catch {
    // best-effort
  } finally {
    clientPromise = null;
  }
}
