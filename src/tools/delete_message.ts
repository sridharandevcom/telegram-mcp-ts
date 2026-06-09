/**
 * delete_message — delete one or more messages. WRITE tool, DESTRUCTIVE and
 * irreversible, so it is confirm-guarded (preview → confirm) like the send tools.
 */

import { z } from "zod";
import { getMtprotoClient } from "../client/mtproto.js";
import { mtprotoLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { resolveEntity, describePeer, peerKey } from "../lib/entities.js";
import { chatRef } from "../lib/schemas.js";
import { signature, consumeConfirmation, buildPreview } from "../lib/confirm.js";
import { defineTool } from "./registry.js";

export const deleteMessageTool = defineTool({
  name: "delete_message",
  title: "Delete Messages",
  description:
    "Delete one or more messages from a chat. DESTRUCTIVE and irreversible. " +
    "Guarded: the first call returns a PREVIEW of what would be deleted and " +
    "deletes nothing; call again with the returned confirmToken to delete. " +
    "By default deletes for everyone (revoke).",
  mode: "mtproto",
  annotations: { readOnlyHint: false, destructiveHint: true },
  inputSchema: {
    chat: chatRef,
    messageIds: z
      .array(z.number().int().positive())
      .min(1, "provide at least one message id")
      .max(100, "delete at most 100 messages at once")
      .describe("Message ids to delete."),
    revoke: z
      .boolean()
      .optional()
      .default(true)
      .describe("Delete for everyone (true) vs only for yourself (false)."),
    confirmToken: z
      .string()
      .optional()
      .describe("Omit to preview. Pass the token from the preview to actually delete."),
  },
  async handler({ chat, messageIds, revoke, confirmToken }) {
    const client = await getMtprotoClient();
    const entity = await resolveEntity(client, chat);
    const recipient = describePeer(entity);

    const sig = signature({ action: "delete_message", chat, messageIds, revoke });

    if (!confirmToken) {
      const caution =
        `This permanently deletes ${messageIds.length} message(s)` +
        `${revoke ? " for everyone" : " for you"}. Deletion cannot be undone.`;
      return okJson(buildPreview("delete_message", recipient, { messageIds, revoke }, sig, caution));
    }

    consumeConfirmation(confirmToken, sig);

    await mtprotoLimiter.acquire(peerKey(entity));
    await client.deleteMessages(entity, messageIds, { revoke });

    return okJson({
      status: "deleted",
      deletedCount: messageIds.length,
      messageIds,
      revoke,
      chat: recipient,
    });
  },
});
