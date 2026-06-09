/**
 * delete_bot_message — delete one or more messages as the bot (Bot API).
 * WRITE tool, DESTRUCTIVE and irreversible, so it is confirm-guarded.
 */

import { z } from "zod";
import { callBot, normalizeChatId } from "../client/bot.js";
import { botLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { signature, consumeConfirmation, buildPreview } from "../lib/confirm.js";
import { defineTool } from "./registry.js";

export const deleteBotMessageTool = defineTool({
  name: "delete_bot_message",
  title: "Bot: Delete Messages",
  description:
    "Delete one or more messages the bot can delete. DESTRUCTIVE and irreversible. " +
    "Guarded: the first call previews what would be deleted and deletes nothing; " +
    "call again with the returned confirmToken to delete.",
  mode: "bot",
  annotations: { readOnlyHint: false, destructiveHint: true },
  inputSchema: {
    chatId: z.string().min(1).describe("Chat containing the messages."),
    messageIds: z.array(z.number().int().positive()).min(1).max(100).describe("Message ids to delete."),
    confirmToken: z
      .string()
      .optional()
      .describe("Omit to preview. Pass the token from the preview to actually delete."),
  },
  async handler({ chatId, messageIds, confirmToken }) {
    const cid = normalizeChatId(chatId);
    const sig = signature({ action: "delete_bot_message", chatId, messageIds });

    if (!confirmToken) {
      const caution = `This permanently deletes ${messageIds.length} message(s). Deletion cannot be undone.`;
      return okJson(buildPreview("delete_bot_message", { chatId: cid }, { messageIds }, sig, caution));
    }

    consumeConfirmation(confirmToken, sig);

    await botLimiter.acquire(String(cid));
    if (messageIds.length === 1) {
      await callBot("deleteMessage", { chat_id: cid, message_id: messageIds[0] });
    } else {
      await callBot("deleteMessages", { chat_id: cid, message_ids: messageIds });
    }
    return okJson({ status: "deleted", chatId: cid, count: messageIds.length });
  },
});
