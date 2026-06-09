/**
 * Entity resolution + light formatting helpers shared by the MTProto tools.
 *
 * Resolving a chat reference to a Telegram entity is the one thing nearly every
 * tool needs, and it has sharp edges (numeric IDs need to be in the session
 * cache), so it lives in exactly one place with a friendly error.
 */

import bigInt from "big-integer";
import type { TelegramClient } from "telegram";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyEntity = any;

const SELF_RE = /^(me|self|saved|saved[_ ]?messages)$/i;
const NUMERIC_RE = /^-?\d+$/;

/**
 * Resolve a user-supplied chat reference ("me", @username, or numeric id) to a
 * gramjs entity. Throws a clear, actionable error if it can't.
 */
export async function resolveEntity(
  client: TelegramClient,
  chat: string,
): Promise<AnyEntity> {
  const t = chat.trim();
  if (SELF_RE.test(t)) {
    return client.getEntity("me");
  }

  const ref: string | ReturnType<typeof bigInt> = NUMERIC_RE.test(t) ? bigInt(t) : t;

  try {
    return await client.getEntity(ref as never);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not resolve chat "${chat}". ` +
        "Use \"me\" for Saved Messages, an @username, or a numeric ID that the " +
        "session already knows (run get_dialogs first to populate it). " +
        `[${reason}]`,
    );
  }
}

/** Human-friendly display name for any user/chat/channel entity. */
export function displayName(entity: AnyEntity): string {
  if (!entity) return "Unknown";
  if (entity.className === "User" || entity.firstName !== undefined) {
    const name = [entity.firstName, entity.lastName].filter(Boolean).join(" ").trim();
    if (name) return name;
    if (entity.username) return `@${entity.username}`;
    return entity.id ? entity.id.toString() : "Unknown";
  }
  return entity.title ?? (entity.username ? `@${entity.username}` : "Unknown");
}

/** Coarse type classification for an entity. */
export function entityType(
  entity: AnyEntity,
): "user" | "bot" | "group" | "channel" | "unknown" {
  if (!entity) return "unknown";
  switch (entity.className) {
    case "User":
      return entity.bot ? "bot" : "user";
    case "Chat":
    case "ChatForbidden":
      return "group";
    case "Channel":
    case "ChannelForbidden":
      return entity.megagroup ? "group" : "channel";
    default:
      return "unknown";
  }
}

/** Compact descriptor used in tool responses. */
export function describePeer(entity: AnyEntity): {
  id: string | null;
  name: string;
  type: string;
} {
  return {
    id: entity?.id ? entity.id.toString() : null,
    name: displayName(entity),
    type: entityType(entity),
  };
}

/** Stable per-chat key for rate limiting. */
export function peerKey(entity: AnyEntity): string {
  return entity?.id ? entity.id.toString() : "unknown";
}
