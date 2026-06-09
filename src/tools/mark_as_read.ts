/**
 * mark_as_read — mark a chat's messages as read.
 *
 * Technically a write (it updates read state server-side) but non-destructive.
 *
 * Channel/supergroup nuance: these go through `channels.readHistory`, where
 * `max_id` MUST be an explicit message id (a `max_id` of 0 — the default when
 * none is given — is a no-op). DMs/basic groups use `messages.readHistory`,
 * where the default already means "all". So when no maxId is supplied for a
 * channel/supergroup, we auto-resolve the latest message id first. DMs, basic
 * groups, and explicit-maxId calls are unaffected.
 */

import { z } from "zod";
import { getMtprotoClient } from "../client/mtproto.js";
import { mtprotoLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { resolveEntity, describePeer, peerKey } from "../lib/entities.js";
import { chatRef } from "../lib/schemas.js";
import { defineTool } from "./registry.js";

export const markAsReadTool = defineTool({
  name: "mark_as_read",
  title: "Mark As Read",
  description:
    "Mark a chat's messages as read (clears the unread badge). Optionally only up " +
    "to a specific message id. For channels/supergroups the latest message id is " +
    "resolved automatically when none is given. Non-destructive.",
  mode: "mtproto",
  annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
  inputSchema: {
    chat: chatRef,
    maxId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Mark read up to and including this message id (default: all)."),
  },
  async handler({ chat, maxId }) {
    const client = await getMtprotoClient();
    const entity = await resolveEntity(client, chat);

    // Channels & supergroups are className "Channel" and need an explicit max_id.
    const isChannel = (entity as { className?: string }).className === "Channel";

    let effectiveMaxId = maxId;
    let autoResolvedLatest = false;
    if (effectiveMaxId === undefined && isChannel) {
      await mtprotoLimiter.acquire(peerKey(entity));
      const latest = await client.getMessages(entity, { limit: 1 });
      const latestId = latest[0]?.id;
      if (latestId) {
        effectiveMaxId = latestId;
        autoResolvedLatest = true;
      }
    }

    await mtprotoLimiter.acquire(peerKey(entity));
    const result = await client.markAsRead(
      entity,
      undefined,
      effectiveMaxId !== undefined ? { maxId: effectiveMaxId } : {},
    );

    return okJson({
      ok: Boolean(result),
      chat: describePeer(entity),
      maxId: effectiveMaxId ?? null,
      autoResolvedLatest,
    });
  },
});
