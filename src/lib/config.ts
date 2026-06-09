/**
 * Centralized environment configuration and mode detection.
 *
 * The server is dual-mode:
 *   - MTProto mode   : requires TELEGRAM_API_ID + TELEGRAM_API_HASH (+ session for tools)
 *   - Bot API mode   : requires TELEGRAM_BOT_TOKEN
 *
 * Mode detection lives here from the
 * start so the two modes stay cleanly isolated.
 */

export type Mode = "mtproto" | "bot";

export interface MtprotoConfig {
  apiId: number;
  apiHash: string;
  /** Empty string on first login; populated string for normal operation. */
  session: string;
}

/** Read an env var, trimming whitespace and treating "" as undefined. */
function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** True if MTProto credentials (api id + hash) are present. */
export function hasMtprotoCredentials(): boolean {
  return readEnv("TELEGRAM_API_ID") !== undefined && readEnv("TELEGRAM_API_HASH") !== undefined;
}

/** True if a Bot API token is present. */
export function hasBotCredentials(): boolean {
  return readEnv("TELEGRAM_BOT_TOKEN") !== undefined;
}

/** Which modes are enabled given the current environment. */
export function detectModes(): Mode[] {
  const modes: Mode[] = [];
  if (hasMtprotoCredentials()) modes.push("mtproto");
  if (hasBotCredentials()) modes.push("bot");
  return modes;
}

export interface SafetyConfig {
  /** When on (default), use conservative rate limits to avoid spam flags/bans. */
  safeMode: boolean;
}

/**
 * Account-safety configuration. Safe mode is ON by default and only disabled by
 * an explicit falsey value, so the protective behavior can't be lost by accident.
 */
export function getSafetyConfig(): SafetyConfig {
  const raw = readEnv("TELEGRAM_SAFE_MODE");
  const safeMode = raw === undefined ? true : !/^(false|0|off|no)$/i.test(raw);
  return { safeMode };
}

/**
 * Meta-mode (lazy tool loading): when on, the server exposes only `list_tools` +
 * `call_tool` instead of the full tool surface, to keep a client's context small
 * once the tool count grows. Off by default.
 */
export function getMetaMode(): boolean {
  const raw = readEnv("TELEGRAM_META_MODE");
  return raw !== undefined && /^(true|1|on|yes)$/i.test(raw);
}

export interface TransportConfig {
  kind: "stdio" | "http";
  port: number;
  host: string;
}

/** Transport selection: stdio (default) or http (TELEGRAM_TRANSPORT=http). */
export function getTransportConfig(): TransportConfig {
  const kind = (readEnv("TELEGRAM_TRANSPORT") ?? "stdio").toLowerCase() === "http" ? "http" : "stdio";
  const port = Number.parseInt(readEnv("TELEGRAM_HTTP_PORT") ?? "3000", 10) || 3000;
  const host = readEnv("TELEGRAM_HTTP_HOST") ?? "127.0.0.1";
  return { kind, port, host };
}

/** Resolve the Bot API token, or throw a clear error. */
export function getBotToken(): string {
  const token = readEnv("TELEGRAM_BOT_TOKEN");
  if (token === undefined) {
    throw new Error(
      "Bot API mode requires TELEGRAM_BOT_TOKEN. Create a bot with @BotFather and " +
        "set the token it gives you.",
    );
  }
  return token;
}

/**
 * Resolve MTProto config from the environment.
 *
 * @param requireSession when true (normal tool operation) a missing/empty
 *        TELEGRAM_SESSION is a hard error. The auth login flow passes false
 *        because it is in the business of creating the session.
 */
export function getMtprotoConfig(requireSession = true): MtprotoConfig {
  const apiIdRaw = readEnv("TELEGRAM_API_ID");
  const apiHash = readEnv("TELEGRAM_API_HASH");

  if (apiIdRaw === undefined || apiHash === undefined) {
    throw new Error(
      "MTProto mode requires TELEGRAM_API_ID and TELEGRAM_API_HASH. " +
        "Get them from https://my.telegram.org -> API development tools.",
    );
  }

  const apiId = Number.parseInt(apiIdRaw, 10);
  if (!Number.isInteger(apiId) || apiId <= 0) {
    throw new Error(`TELEGRAM_API_ID must be a positive integer, got: ${apiIdRaw}`);
  }

  const session = readEnv("TELEGRAM_SESSION") ?? "";
  if (requireSession && session.length === 0) {
    throw new Error(
      "TELEGRAM_SESSION is empty. Run the one-time login: `npm run auth login` " +
        "and put the printed session string into TELEGRAM_SESSION.",
    );
  }

  return { apiId, apiHash, session };
}
