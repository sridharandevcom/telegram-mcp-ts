/**
 * send_bot_message — send a text message as the bot (Bot API). WRITE tool,
 * confirm-guarded (every send tool is guarded, both modes).
 */

import { z } from "zod";
import { callBot, normalizeChatId } from "../client/bot.js";
import { botLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { signature, consumeConfirmation, buildPreview } from "../lib/confirm.js";
import { defineTool } from "./registry.js";

interface SentMessage {
  message_id: number;
  date: number;
}

export const sendBotMessageTool = defineTool({
  name: "send_bot_message",
  title: "Bot: Send Message",
  description:
    "Send a text message as the bot to a chat. Guarded: first call previews and " +
    "sends nothing; call again with the returned confirmToken to send. The bot can " +
    "only message users who have started it or chats it belongs to.",
  mode: "bot",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  inputSchema: {
    chatId: z
      .string()
      .min(1)
      .describe("Target chat: numeric chat id or @channelusername."),
    text: z.string().min(1, "text must not be empty").describe("Message text."),
    parseMode: z
      .enum(["HTML", "Markdown", "MarkdownV2"])
      .optional()
      .describe("Optional formatting mode for the text."),
    replyToMessageId: z
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
  async handler({ chatId, text, parseMode, replyToMessageId, confirmToken }) {
    const cid = normalizeChatId(chatId);
    const sig = signature({
      action: "send_bot_message",
      chatId,
      text,
      parseMode: parseMode ?? null,
      replyToMessageId: replyToMessageId ?? null,
    });

    if (!confirmToken) {
      return okJson(
        buildPreview(
          "send_bot_message",
          { chatId: cid },
          { text, parseMode: parseMode ?? null, replyToMessageId: replyToMessageId ?? null },
          sig,
        ),
      );
    }

    consumeConfirmation(confirmToken, sig);

    await botLimiter.acquire(String(cid));
    const result = await callBot<SentMessage>("sendMessage", {
      chat_id: cid,
      text,
      parse_mode: parseMode,
      reply_to_message_id: replyToMessageId,
    });

    return okJson({ status: "sent", messageId: result.message_id, chatId: cid, date: result.date });
  },
});
