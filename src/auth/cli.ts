/**
 * Auth CLI — one-time login flow that produces a reusable MTProto session string.
 *
 * Usage:
 *   telegram-mcp-ts-auth login          interactive login -> prints session string
 *   telegram-mcp-ts-auth logout         revoke the current session server-side
 *   telegram-mcp-ts-auth clear-session  forget the local session (guidance only)
 *
 * The session string is the only thing written to stdout on success, so it can
 * be redirected to a file. All prompts/status go to stderr.
 */

import { Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { createMtprotoClient } from "../client/mtproto.js";
import { getMtprotoConfig } from "../lib/config.js";
import { ask, askHidden, confirm } from "./prompt.js";

function log(line = ""): void {
  process.stderr.write(`${line}\n`);
}

async function resolveApiCredentials(): Promise<{ apiId: number; apiHash: string }> {
  const envId = process.env.TELEGRAM_API_ID?.trim();
  const envHash = process.env.TELEGRAM_API_HASH?.trim();

  let apiId: number;
  if (envId && envId.length > 0) {
    apiId = Number.parseInt(envId, 10);
  } else {
    apiId = Number.parseInt(await ask("API ID: "), 10);
  }
  if (!Number.isInteger(apiId) || apiId <= 0) {
    throw new Error("API ID must be a positive integer (from https://my.telegram.org).");
  }

  let apiHash = envHash ?? "";
  if (apiHash.length === 0) {
    apiHash = await ask("API HASH: ");
  }
  if (apiHash.length === 0) {
    throw new Error("API HASH is required (from https://my.telegram.org).");
  }

  return { apiId, apiHash };
}

async function login(): Promise<void> {
  log("=== telegram-mcp-ts login ===");
  log("Get API ID/HASH from https://my.telegram.org -> API development tools.");
  log("Use a THROWAWAY account for development. This grants full account access.");
  log("");

  const { apiId, apiHash } = await resolveApiCredentials();

  const client = createMtprotoClient({ apiId, apiHash, session: "" });

  await client.start({
    phoneNumber: async () => ask("Phone number (international, e.g. +15551234567): "),
    phoneCode: async () => ask("Login code (sent via Telegram/SMS): "),
    password: async () => askHidden("2FA password (leave blank if none): "),
    onError: (err) => {
      log(`  ! ${err?.message ?? String(err)}`);
    },
  });

  const sessionString = (client.session as StringSession).save();
  await client.disconnect();

  log("");
  log("Login successful. Your session string is printed below (stdout).");
  log("Add it to your environment as TELEGRAM_SESSION (treat it like a password):");
  log("");
  // The one and only stdout write — the secret itself.
  process.stdout.write(`${sessionString}\n`);
  log("");
  log("Example claude_desktop_config.json env block:");
  log('  "env": {');
  log(`    "TELEGRAM_API_ID": "${apiId}",`);
  log('    "TELEGRAM_API_HASH": "<your api hash>",');
  log('    "TELEGRAM_SESSION": "<the string above>"');
  log("  }");
}

async function logout(): Promise<void> {
  log("=== telegram-mcp-ts logout ===");
  const config = getMtprotoConfig(/* requireSession */ true);
  const client = createMtprotoClient(config);
  await client.connect();

  if (!(await client.isUserAuthorized())) {
    log("Session is already invalid/unauthorized. Nothing to revoke.");
    await client.disconnect();
    return;
  }

  if (!(await confirm("This revokes the session server-side. Continue?"))) {
    log("Aborted.");
    await client.disconnect();
    return;
  }

  await client.invoke(new Api.auth.LogOut());
  await client.disconnect();
  log("Session revoked. Remove TELEGRAM_SESSION from your environment.");
}

function clearSession(): void {
  log("=== telegram-mcp-ts clear-session ===");
  log("Sessions are stored in the TELEGRAM_SESSION environment variable, not on disk.");
  log("To forget the local session, unset it:");
  log("  PowerShell:  Remove-Item Env:TELEGRAM_SESSION");
  log("  bash/zsh:    unset TELEGRAM_SESSION");
  log("  .env file:   delete the TELEGRAM_SESSION line");
  log("");
  log("Note: this does NOT revoke the session on Telegram's servers.");
  log("Use `logout` for that.");
}

async function main(): Promise<void> {
  const command = (process.argv[2] ?? "").toLowerCase();

  switch (command) {
    case "login":
      await login();
      break;
    case "logout":
      await logout();
      break;
    case "clear-session":
      clearSession();
      break;
    default:
      log("telegram-mcp-ts auth CLI");
      log("");
      log("Commands:");
      log("  login          Interactive login; prints a reusable session string.");
      log("  logout         Revoke the current session on Telegram's servers.");
      log("  clear-session  Show how to forget the local session.");
      process.exitCode = command ? 1 : 0;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    log(`Error: ${err?.message ?? String(err)}`);
    process.exit(1);
  });
