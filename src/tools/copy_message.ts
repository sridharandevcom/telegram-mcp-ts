/**
 * copy_message — copy a message to another chat as the bot, WITHOUT the
 * 'forwarded from' header. WRITE tool, confirm-guarded.
 */

import { z } from "zod";
import { callBot, normalizeChatId } from "../client/bot.js";
import { botLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { signature, consumeConfirmation, buildPreview } from "../lib/confirm.js";
import { defineTool } from "./registry.js";

export const copyMessageTool = defineTool({
  name: "copy_message",
  title: "Bot: Copy Message",
  description:
    "Copy a message to another chat as the bot (no 'forwarded from' header). " +
    "Optionally override the caption. Guarded: preview first, then confirm.",
  mode: "bot",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  inputSchema: {
    toChatId: z.string().min(1).describe("Destination chat id or @username."),
    fromChatId: z.string().min(1).describe("Source chat id or @username."),
    messageId: z.number().int().positive().describe("Message id to copy."),
    caption: z.string().optional().describe("Optional caption override."),
    confirmToken: z.string().optional().describe("Omit to preview; pass to copy."),
  },
  async handler({ toChatId, fromChatId, messageId, caption, confirmToken }) {
    const to = normalizeChatId(toChatId);
    const from = normalizeChatId(fromChatId);
    const sig = signature({ action: "copy_message", toChatId, fromChatId, messageId, caption: caption ?? null });

    if (!confirmToken) {
      return okJson(buildPreview("copy_message", { chatId: to }, { fromChatId: from, messageId, caption: caption ?? null }, sig));
    }
    consumeConfirmation(confirmToken, sig);

    await botLimiter.acquire(String(to));
    const result = await callBot<{ message_id: number }>("copyMessage", {
      chat_id: to,
      from_chat_id: from,
      message_id: messageId,
      caption,
    });
    return okJson({ status: "copied", toChatId: to, messageId: result.message_id });
  },
});
