/**
 * get_dialogs — list the account's chats/groups/channels.
 *
 * This is the discovery tool: it surfaces the chat IDs every other tool needs.
 * Read-only.
 */

import { z } from "zod";
import { getMtprotoClient } from "../client/mtproto.js";
import { mtprotoLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { entityType } from "../lib/entities.js";
import { toIso, truncate } from "../lib/format.js";
import { limitField } from "../lib/schemas.js";
import { defineTool } from "./registry.js";

export const getDialogsTool = defineTool({
  name: "get_dialogs",
  title: "List Chats",
  description:
    "List the account's conversations (users, groups, channels) newest-first, " +
    "with their IDs, unread counts, and a preview of the last message. Use this " +
    "to discover the chat ID/username you need for other tools. Read-only.",
  mode: "mtproto",
  annotations: { readOnlyHint: true },
  inputSchema: {
    limit: limitField(30, 100),
    archived: z
      .boolean()
      .optional()
      .default(false)
      .describe("List archived chats instead of the main list."),
  },
  async handler({ limit, archived }) {
    await mtprotoLimiter.acquire("get_dialogs");
    const client = await getMtprotoClient();

    const dialogs = await client.getDialogs({ limit, archived });

    const items = dialogs.map((d) => {
      const last = d.message;
      return {
        id: d.id ? d.id.toString() : null,
        name: d.name ?? d.title ?? null,
        type: entityType(d.entity),
        unreadCount: d.unreadCount ?? 0,
        pinned: Boolean(d.pinned),
        lastMessageDate: toIso(last?.date),
        lastMessage: truncate(last?.message ?? "", 200),
      };
    });

    return okJson({ count: items.length, dialogs: items });
  },
});
