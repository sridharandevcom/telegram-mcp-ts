/**
 * send_message — send a text message to a chat. WRITE tool, guarded by the
 * confirm-before-send pattern.
 *
 * First call (no confirmToken)  -> returns a preview, sends nothing.
 * Second call (with confirmToken) -> actually sends.
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

export const sendMessageTool = defineTool({
  name: "send_message",
  title: "Send Message",
  description:
    "Send a text message to a chat. Guarded: the first call returns a PREVIEW " +
    "and sends nothing; you must call again with the returned confirmToken (and " +
    "the same arguments) to actually send. Optionally reply to a message.",
  mode: "mtproto",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  inputSchema: {
    chat: chatRef,
    text: z.string().min(1, "text must not be empty").describe("Message text to send."),
    replyToMsgId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Id of a message to reply to (optional)."),
    confirmToken: z
      .string()
      .optional()
      .describe("Omit to preview. Pass the token from the preview to actually send."),
  },
  async handler({ chat, text, replyToMsgId, confirmToken }) {
    const client = await getMtprotoClient();
    const entity = await resolveEntity(client, chat);
    const recipient = describePeer(entity);

    const sig = signature({
      action: "send_message",
      chat,
      text,
      replyToMsgId: replyToMsgId ?? null,
    });

    if (!confirmToken) {
      // Anti-ban: warn before cold outreach to a non-contact user.
      const e = entity as { className?: string; self?: boolean; contact?: boolean };
      const coldContact = e?.className === "User" && !e.self && !e.contact;
      const caution = coldContact
        ? "Recipient is NOT in your contacts. Cold/unsolicited messages to strangers " +
          "are a common trigger for Telegram account restrictions — only confirm if this is wanted."
        : undefined;
      return okJson(
        buildPreview(
          "send_message",
          recipient,
          { text, replyToMsgId: replyToMsgId ?? null },
          sig,
          caution,
        ),
      );
    }

    // Confirmed path: verify + consume the token, then send.
    consumeConfirmation(confirmToken, sig);

    await mtprotoLimiter.acquire(peerKey(entity));
    const sent = await client.sendMessage(entity, {
      message: text,
      ...(replyToMsgId !== undefined ? { replyTo: replyToMsgId } : {}),
    });

    return okJson({
      status: "sent",
      messageId: sent.id,
      recipient,
      date: toIso(sent.date),
    });
  },
});
