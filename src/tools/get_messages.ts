/**
 * get_messages — read message history from a chat. Read-only.
 */

import { z } from "zod";
import { getMtprotoClient } from "../client/mtproto.js";
import { mtprotoLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { resolveEntity, describePeer, peerKey } from "../lib/entities.js";
import { messageToView } from "../lib/format.js";
import { chatRef, limitField } from "../lib/schemas.js";
import { defineTool } from "./registry.js";

export const getMessagesTool = defineTool({
  name: "get_messages",
  title: "Read Messages",
  description:
    "Read message history from a chat (newest first). Returns sender, text, media " +
    "type, reactions, forward info, reply info, and timestamps. Page backwards with " +
    "offsetId, or bound by date with untilDate / sinceDate (ISO-8601). Read-only.",
  mode: "mtproto",
  annotations: { readOnlyHint: true },
  inputSchema: {
    chat: chatRef,
    limit: limitField(20, 100),
    offsetId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Return messages older than this message id (for pagination)."),
    untilDate: z
      .string()
      .optional()
      .describe("Only messages at/before this time (ISO-8601, e.g. 2026-06-01T00:00:00Z)."),
    sinceDate: z
      .string()
      .optional()
      .describe("Only messages at/after this time (ISO-8601). Applied as a filter."),
  },
  async handler({ chat, limit, offsetId, untilDate, sinceDate }) {
    const parseDate = (s: string | undefined, label: string): Date | undefined => {
      if (s === undefined) return undefined;
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) throw new Error(`Invalid ${label}: "${s}" (use ISO-8601).`);
      return d;
    };
    const until = parseDate(untilDate, "untilDate");
    const since = parseDate(sinceDate, "sinceDate");

    const client = await getMtprotoClient();
    const entity = await resolveEntity(client, chat);

    await mtprotoLimiter.acquire(peerKey(entity));
    const messages = await client.getMessages(entity, {
      limit,
      ...(offsetId !== undefined ? { offsetId } : {}),
      ...(until !== undefined ? { offsetDate: Math.floor(until.getTime() / 1000) } : {}),
    });

    const sinceUnix = since ? Math.floor(since.getTime() / 1000) : undefined;
    const filtered =
      sinceUnix !== undefined
        ? messages.filter((m) => (m.date ?? 0) >= sinceUnix)
        : messages;

    const views = filtered.map(messageToView);
    return okJson({
      chat: describePeer(entity),
      count: views.length,
      messages: views,
    });
  },
});
