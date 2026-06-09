/**
 * edit_bot_message — edit the text (or caption) of a message the bot sent.
 * WRITE tool (not confirm-guarded; parity with MTProto edit_message).
 */

import { z } from "zod";
import { callBot, normalizeChatId } from "../client/bot.js";
import { botLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { defineTool } from "./registry.js";

export const editBotMessageTool = defineTool({
  name: "edit_bot_message",
  title: "Bot: Edit Message",
  description:
    "Edit the text or caption of a message the bot previously sent. Use `mode` to " +
    "choose text vs caption.",
  mode: "bot",
  annotations: { readOnlyHint: false, destructiveHint: false },
  inputSchema: {
    chatId: z.string().min(1).describe("Chat containing the message."),
    messageId: z.number().int().positive().describe("Message id to edit."),
    text: z.string().min(1).describe("New text/caption."),
    mode: z.enum(["text", "caption"]).optional().default("text").describe("Edit the text or the caption."),
    parseMode: z.enum(["HTML", "Markdown", "MarkdownV2"]).optional(),
  },
  async handler({ chatId, messageId, text, mode, parseMode }) {
    const cid = normalizeChatId(chatId);
    await botLimiter.acquire(String(cid));
    const method = mode === "caption" ? "editMessageCaption" : "editMessageText";
    const params: Record<string, unknown> = { chat_id: cid, message_id: messageId, parse_mode: parseMode };
    if (mode === "caption") params.caption = text;
    else params.text = text;
    await callBot(method, params);
    return okJson({ status: "edited", chatId: cid, messageId, mode });
  },
});
