/**
 * reply_to_topic — post a message into a specific forum topic in a supergroup.
 * WRITE tool, guarded by the confirm-before-send pattern.
 *
 * Posting into a topic = sending with `replyTo` set to the topic id.
 */

import { z } from "zod";
import { getMtprotoClient } from "../client/mtproto.js";
import { mtprotoLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { resolveEntity, describePeer, peerKey } from "../lib/entities.js";
import { toIso } from "../lib/format.js";
import { chatRef } from "../lib/schemas.js";
import { signature, consumeConfirmation, buildPreview } from "../lib/confirm.js";
import { defineTool } from "./registry.js";

export const replyToTopicTool = defineTool({
  name: "reply_to_topic",
  title: "Post To Forum Topic",
  description:
    "Post a text message into a specific forum topic in a supergroup. Guarded: " +
    "first call previews and sends nothing; call again with the returned " +
    "confirmToken to post. topicId is the topic's opening message id (General = 1).",
  mode: "mtproto",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  inputSchema: {
    chat: chatRef.describe("The supergroup/forum (id or @username)."),
    topicId: z
      .number()
      .int()
      .positive()
      .describe("The forum topic id to post into (General topic = 1)."),
    text: z.string().min(1, "text must not be empty").describe("Message text to post."),
    confirmToken: z
      .string()
      .optional()
      .describe("Omit to preview. Pass the token from the preview to actually post."),
  },
  async handler({ chat, topicId, text, confirmToken }) {
    const client = await getMtprotoClient();
    const entity = await resolveEntity(client, chat);
    const recipient = describePeer(entity);

    const sig = signature({ action: "reply_to_topic", chat, topicId, text });

    if (!confirmToken) {
      return okJson(buildPreview("reply_to_topic", recipient, { topicId, text }, sig));
    }

    consumeConfirmation(confirmToken, sig);

    await mtprotoLimiter.acquire(peerKey(entity));
    const sent = await client.sendMessage(entity, { message: text, replyTo: topicId });

    return okJson({
      status: "posted",
      messageId: sent.id,
      recipient,
      topicId,
      date: toIso(sent.date),
    });
  },
});
