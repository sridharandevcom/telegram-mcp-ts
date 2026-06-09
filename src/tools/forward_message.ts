/**
 * forward_message — forward message(s) between chats as the bot (Bot API).
 * WRITE tool, confirm-guarded (it posts into a chat).
 */

import { z } from "zod";
import { callBot, normalizeChatId } from "../client/bot.js";
import { botLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { signature, consumeConfirmation, buildPreview } from "../lib/confirm.js";
import { defineTool } from "./registry.js";

export const forwardMessageTool = defineTool({
  name: "forward_message",
  title: "Bot: Forward Message",
  description:
    "Forward one or more messages from one chat to another as the bot (keeps the " +
    "'forwarded from' header). Guarded: preview first, then confirm.",
  mode: "bot",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  inputSchema: {
    toChatId: z.string().min(1).describe("Destination chat id or @username."),
    fromChatId: z.string().min(1).describe("Source chat id or @username."),
    messageIds: z.array(z.number().int().positive()).min(1).max(100).describe("Message ids to forward."),
    confirmToken: z.string().optional().describe("Omit to preview; pass to forward."),
  },
  async handler({ toChatId, fromChatId, messageIds, confirmToken }) {
    const to = normalizeChatId(toChatId);
    const from = normalizeChatId(fromChatId);
    const sig = signature({ action: "forward_message", toChatId, fromChatId, messageIds });

    if (!confirmToken) {
      return okJson(buildPreview("forward_message", { chatId: to }, { fromChatId: from, messageIds }, sig));
    }
    consumeConfirmation(confirmToken, sig);

    await botLimiter.acquire(String(to));
    if (messageIds.length === 1) {
      await callBot("forwardMessage", { chat_id: to, from_chat_id: from, message_id: messageIds[0] });
    } else {
      await callBot("forwardMessages", { chat_id: to, from_chat_id: from, message_ids: messageIds });
    }
    return okJson({ status: "forwarded", toChatId: to, fromChatId: from, count: messageIds.length });
  },
});
