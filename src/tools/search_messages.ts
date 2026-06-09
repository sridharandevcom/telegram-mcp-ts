/**
 * search_messages — search within a chat, or globally across all chats.
 * Read-only.
 */

import { z } from "zod";
import { Api } from "telegram";
import { getMtprotoClient } from "../client/mtproto.js";
import { mtprotoLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { resolveEntity, describePeer, peerKey } from "../lib/entities.js";
import { messageToView } from "../lib/format.js";
import { chatRef, limitField } from "../lib/schemas.js";
import { defineTool } from "./registry.js";

export const searchMessagesTool = defineTool({
  name: "search_messages",
  title: "Search Messages",
  description:
    "Search messages by text. Provide a chat to search within it, or omit chat " +
    "to search globally across all your chats. Read-only.",
  mode: "mtproto",
  annotations: { readOnlyHint: true },
  inputSchema: {
    query: z.string().min(1, "query must not be empty").describe("Text to search for."),
    chat: chatRef.optional().describe("Limit search to this chat (omit for global)."),
    limit: limitField(20, 100),
  },
  async handler({ query, chat, limit }) {
    const client = await getMtprotoClient();

    if (chat) {
      const entity = await resolveEntity(client, chat);
      await mtprotoLimiter.acquire(peerKey(entity));
      const messages = await client.getMessages(entity, { search: query, limit });
      return okJson({
        scope: "chat",
        chat: describePeer(entity),
        query,
        count: messages.length,
        messages: messages.map(messageToView),
      });
    }

    // Global search across all chats.
    await mtprotoLimiter.acquire("search_global");
    const result = (await client.invoke(
      new Api.messages.SearchGlobal({
        q: query,
        filter: new Api.InputMessagesFilterEmpty(),
        minDate: 0,
        maxDate: 0,
        offsetRate: 0,
        offsetPeer: new Api.InputPeerEmpty(),
        offsetId: 0,
        limit,
      }),
    )) as Api.messages.Messages | Api.messages.MessagesSlice | Api.messages.ChannelMessages;

    const rawMessages = "messages" in result ? result.messages : [];
    return okJson({
      scope: "global",
      query,
      count: rawMessages.length,
      messages: rawMessages.map(messageToView),
    });
  },
});
