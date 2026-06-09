/**
 * get_topic_messages — read messages from a specific forum topic in a
 * supergroup. Read-only.
 *
 * Forum topics are threads keyed by the id of the message that opened the topic
 * (the "General" topic is id 1). gramjs fetches a topic's messages by passing
 * that id as `replyTo` to getMessages.
 */

import { z } from "zod";
import { getMtprotoClient } from "../client/mtproto.js";
import { mtprotoLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { resolveEntity, describePeer, peerKey } from "../lib/entities.js";
import { messageToView } from "../lib/format.js";
import { chatRef, limitField } from "../lib/schemas.js";
import { defineTool } from "./registry.js";

export const getTopicMessagesTool = defineTool({
  name: "get_topic_messages",
  title: "Read Forum Topic",
  description:
    "Read recent messages from a specific forum topic in a supergroup (newest " +
    "first). topicId is the id of the message that opened the topic (General = 1). " +
    "Read-only.",
  mode: "mtproto",
  annotations: { readOnlyHint: true },
  inputSchema: {
    chat: chatRef.describe("The supergroup/forum (id or @username)."),
    topicId: z
      .number()
      .int()
      .positive()
      .describe("The forum topic id (the opening message id; General topic = 1)."),
    limit: limitField(20, 100),
  },
  async handler({ chat, topicId, limit }) {
    const client = await getMtprotoClient();
    const entity = await resolveEntity(client, chat);

    await mtprotoLimiter.acquire(peerKey(entity));
    const messages = await client.getMessages(entity, { replyTo: topicId, limit });

    return okJson({
      chat: describePeer(entity),
      topicId,
      count: messages.length,
      messages: messages.map(messageToView),
    });
  },
});
