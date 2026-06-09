/**
 * get_unread_summary — compact, AI-friendly digest of unread messages.
 *
 * Returns a compact, LLM-friendly digest of unread messages grouped by chat:
 * sender names, unread counts, and message text pre-truncated to fit a model's
 * context. Built for an agent to read, not ported from a bot library. Read-only.
 */

import { z } from "zod";
import { getMtprotoClient } from "../client/mtproto.js";
import { mtprotoLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { displayName, entityType, peerKey } from "../lib/entities.js";
import { toIso, truncate, mediaLabel } from "../lib/format.js";
import { defineTool } from "./registry.js";

export const getUnreadSummaryTool = defineTool({
  name: "get_unread_summary",
  title: "Unread Summary",
  description:
    "Summarize unread messages across chats in a compact, AI-friendly structure: " +
    "grouped by chat with sender names, unread counts, and truncated message text. " +
    "Tune how many chats and messages per chat to include and an optional lookback " +
    "window. Read-only.",
  mode: "mtproto",
  annotations: { readOnlyHint: true },
  inputSchema: {
    chatLimit: z
      .number()
      .int()
      .positive()
      .max(50)
      .optional()
      .default(10)
      .describe("Max number of unread chats to include (default 10)."),
    perChatLimit: z
      .number()
      .int()
      .positive()
      .max(20)
      .optional()
      .default(5)
      .describe("Max recent messages to show per chat (default 5)."),
    maxChars: z
      .number()
      .int()
      .positive()
      .max(2000)
      .optional()
      .default(280)
      .describe("Truncate each message to this many characters (default 280)."),
    lookbackHours: z
      .number()
      .positive()
      .optional()
      .describe("Only include messages newer than this many hours (optional)."),
  },
  async handler({ chatLimit, perChatLimit, maxChars, lookbackHours }) {
    const client = await getMtprotoClient();

    await mtprotoLimiter.acquire("get_unread_summary");
    const dialogs = await client.getDialogs({ limit: 100 });

    const unread = dialogs
      .filter((d) => (d.unreadCount ?? 0) > 0)
      .sort((a, b) => (b.message?.date ?? 0) - (a.message?.date ?? 0));

    const selected = unread.slice(0, chatLimit);
    const cutoff =
      lookbackHours !== undefined ? Math.floor(Date.now() / 1000) - lookbackHours * 3600 : null;

    const chats = [];
    let messagesShown = 0;

    for (const d of selected) {
      const count = Math.min(perChatLimit, d.unreadCount ?? perChatLimit);
      await mtprotoLimiter.acquire(peerKey(d.entity));
      const msgs = await client.getMessages(d.entity, { limit: count });

      const filtered = cutoff !== null ? msgs.filter((m) => (m.date ?? 0) >= cutoff) : msgs;

      const messages = filtered.map((m) => {
        const sender = m.sender;
        const body = m.message && m.message.length > 0 ? m.message : m.media ? `[${mediaLabel(m.media)}]` : "";
        return {
          id: m.id,
          from: sender ? displayName(sender) : m.senderId ? m.senderId.toString() : null,
          date: toIso(m.date),
          text: truncate(body, maxChars),
        };
      });

      messagesShown += messages.length;
      chats.push({
        id: d.id ? d.id.toString() : null,
        name: d.name ?? d.title ?? null,
        type: entityType(d.entity),
        unreadCount: d.unreadCount ?? 0,
        messages,
      });
    }

    return okJson({
      generatedAt: new Date().toISOString(),
      totalUnreadChats: unread.length,
      chatsShown: selected.length,
      messagesShown,
      ...(lookbackHours !== undefined ? { lookbackHours } : {}),
      chats,
    });
  },
});
