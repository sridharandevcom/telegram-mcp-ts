/**
 * doctor — diagnostic command.
 *
 * Codifies the setup/cross-platform failure modes that plague the whole Telegram
 * MCP ecosystem (Node version, missing creds, invalid/expired session, no
 * connectivity) into a single self-check with actionable output.
 *
 * Run via: `node dist/index.js doctor` (or `npx telegram-mcp-ts doctor`).
 * Writes to stdout (it's a CLI command, not the MCP stdio server).
 */

import {
  detectModes,
  getSafetyConfig,
  hasMtprotoCredentials,
  hasBotCredentials,
  getMtprotoConfig,
} from "./config.js";
import { createMtprotoClient } from "../client/mtproto.js";
import { callBot } from "../client/bot.js";

type Status = "ok" | "warn" | "fail";

function mark(status: Status): string {
  return status === "ok" ? "✓" : status === "warn" ? "⚠" : "✗";
}

function line(status: Status, msg: string): Status {
  process.stdout.write(`  ${mark(status)} ${msg}\n`);
  return status;
}

function header(text: string): void {
  process.stdout.write(`\n${text}\n`);
}

/** Race a promise against a timeout so a stalled network call can't hang doctor. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms),
    ),
  ]);
}

function checkNode(): Status {
  const [maj = 0, min = 0] = process.versions.node.split(".").map(Number);
  const ok = maj > 18 || (maj === 18 && min >= 18);
  return ok
    ? line("ok", `Node ${process.versions.node} (>= 18.18 required)`)
    : line(
        "fail",
        `Node ${process.versions.node} is too old — need >= 18.18. ` +
          "Install Node 20+ (e.g. via nvm) and retry.",
      );
}

async function checkMtproto(): Promise<Status> {
  header("MTProto (user account):");
  if (!hasMtprotoCredentials()) {
    return line("warn", "TELEGRAM_API_ID / TELEGRAM_API_HASH not set — MTProto mode disabled.");
  }
  line("ok", "TELEGRAM_API_ID and TELEGRAM_API_HASH present.");

  let config;
  try {
    config = getMtprotoConfig(true);
  } catch (err) {
    return line(
      "fail",
      `${err instanceof Error ? err.message : String(err)} (run: telegram-mcp-ts-auth login)`,
    );
  }

  const client = createMtprotoClient(config);
  try {
    await withTimeout(client.connect(), 15_000, "Telegram connection");
    line("ok", "Connected to Telegram data center.");
    if (await withTimeout(client.isUserAuthorized(), 15_000, "Authorization check")) {
      const me = (await withTimeout(client.getMe(), 15_000, "getMe")) as {
        username?: string;
        firstName?: string;
      };
      line("ok", `Session valid — logged in as ${me.username ? "@" + me.username : me.firstName ?? "user"}.`);
      return "ok";
    }
    return line("fail", "Session present but NOT authorized (expired/revoked). Re-run: telegram-mcp-ts-auth login");
  } catch (err) {
    return line(
      "fail",
      `Connection/session check failed: ${err instanceof Error ? err.message : String(err)} ` +
        "(network block to Telegram? try a VPN, or verify the session.)",
    );
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

async function checkBot(): Promise<Status> {
  header("Bot API:");
  if (!hasBotCredentials()) {
    return line("warn", "TELEGRAM_BOT_TOKEN not set — Bot API mode disabled.");
  }
  line("ok", "TELEGRAM_BOT_TOKEN present.");
  try {
    const me = await callBot<{ username?: string }>("getMe", {}, { retry: false });
    return line("ok", `Bot token valid — bot is @${me.username ?? "(unknown)"}.`);
  } catch (err) {
    return line("fail", `Bot token check failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Run all checks; resolve with a process exit code (0 = healthy). */
export async function runDoctor(): Promise<number> {
  process.stdout.write("telegram-mcp-ts doctor — environment self-check\n");

  header("Runtime:");
  const node = checkNode();

  const modes = detectModes();
  const { safeMode } = getSafetyConfig();
  header("Configuration:");
  if (modes.length === 0) {
    line("fail", "No credentials found — set MTProto and/or Bot API env vars.");
  } else {
    line("ok", `Modes enabled: ${modes.join(", ")}`);
  }
  line(
    safeMode ? "ok" : "warn",
    `Safe mode: ${safeMode ? "ON (conservative rate limits)" : "OFF (looser limits — higher ban risk)"}`,
  );

  // checkMtproto / checkBot each handle the "not configured" case internally.
  const mtStatus = await checkMtproto();
  const botStatus = await checkBot();

  const statuses: Status[] = [node, mtStatus, botStatus];
  const anyFail = statuses.includes("fail") || modes.length === 0;

  header(anyFail ? "Result: ✗ issues found — see ✗ lines above." : "Result: ✓ ready.");
  return anyFail ? 1 : 0;
}
