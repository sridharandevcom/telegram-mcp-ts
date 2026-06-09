/**
 * Confirm-before-send safety pattern.
 *
 * An agent must not be able to send a message by accident.
 * Every send tool uses this two-step flow:
 *
 *   1. First call (no confirmToken)  -> validate + resolve recipient, store a
 *      single-use token bound to a *signature* of exactly what would be sent,
 *      and return a PREVIEW. Nothing is sent.
 *   2. Second call (with confirmToken + identical args) -> the token is verified
 *      against the signature, consumed, and only then is the message sent.
 *
 * Because the token is unguessable, server-minted, single-use, and bound to the
 * exact recipient+content, there is no way to reach the actual send path in a
 * single call or with mismatched content.
 */

import { randomUUID } from "node:crypto";

/** How long a preview stays confirmable before it must be re-previewed. */
const TTL_MS = 5 * 60 * 1000;

interface Pending {
  signature: string;
  expiresAt: number;
}

const store = new Map<string, Pending>();

function pruneExpired(now = Date.now()): void {
  for (const [token, pending] of store) {
    if (pending.expiresAt <= now) store.delete(token);
  }
}

/**
 * Build a stable signature string from the parts that define "what is sent".
 * Both the preview and confirm calls must produce the same object shape.
 */
export function signature(parts: Record<string, unknown>): string {
  return JSON.stringify(parts);
}

/** Mint a single-use confirmation token bound to a signature. */
export function createConfirmation(sig: string): {
  confirmToken: string;
  expiresInSeconds: number;
} {
  pruneExpired();
  const confirmToken = randomUUID();
  store.set(confirmToken, { signature: sig, expiresAt: Date.now() + TTL_MS });
  return { confirmToken, expiresInSeconds: Math.round(TTL_MS / 1000) };
}

/**
 * Verify and consume a confirmation token. Throws (with an actionable message)
 * if the token is missing/expired or the content no longer matches the preview.
 * On success the token is deleted so it cannot be replayed.
 */
export function consumeConfirmation(confirmToken: string, sig: string): void {
  pruneExpired();
  const pending = store.get(confirmToken);
  if (!pending) {
    throw new Error(
      "Invalid or expired confirmToken. Call this tool again WITHOUT confirmToken " +
        "to get a fresh preview, then call it with the returned confirmToken to send.",
    );
  }
  if (pending.signature !== sig) {
    throw new Error(
      "confirmToken does not match this request — the recipient or content changed " +
        "since the preview. Re-run without confirmToken to preview the new content, " +
        "then confirm.",
    );
  }
  store.delete(confirmToken);
}

/** Shape of the preview payload returned by a send tool's first call. */
export interface SendPreview {
  status: "preview_pending_confirmation";
  action: string;
  /** The target chat/peer of the action. */
  recipient: unknown;
  /** What the confirmed call will do (e.g. the text to send, or ids to delete). */
  details: Record<string, unknown>;
  confirmToken: string;
  expiresInSeconds: number;
  instructions: string;
  /** Optional safety warning (e.g. cold-contact outreach, or irreversible delete). */
  caution?: string;
}

/** Build the standard preview response body for any guarded (send/delete) tool. */
export function buildPreview(
  action: string,
  recipient: unknown,
  details: Record<string, unknown>,
  sig: string,
  caution?: string,
): SendPreview {
  const { confirmToken, expiresInSeconds } = createConfirmation(sig);
  const preview: SendPreview = {
    status: "preview_pending_confirmation",
    action,
    recipient,
    details,
    confirmToken,
    expiresInSeconds,
    instructions:
      `No action taken yet. To proceed, call ${action} again with the SAME ` +
      "arguments plus confirmToken set to the value above.",
  };
  if (caution) preview.caution = caution;
  return preview;
}
