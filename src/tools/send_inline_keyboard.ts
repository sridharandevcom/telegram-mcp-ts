/**
 * send_inline_keyboard — send a message with inline buttons (Bot API). WRITE
 * tool, confirm-guarded. Button taps produce callback queries that
 * handle_callback can receive.
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

const buttonSchema = z.object({
  text: z.string().min(1).describe("Button label."),
  callbackData: z
    .string()
    .min(1)
    .max(64)
    .describe("Data sent back when tapped (max 64 bytes); received by handle_callback."),
});

export const sendInlineKeyboardTool = defineTool({
  name: "send_inline_keyboard",
  title: "Bot: Send Inline Keyboard",
  description:
    "Send a message with an inline keyboard (rows of tappable buttons). Each " +
    "button carries callbackData returned to handle_callback when tapped. Guarded: " +
    "first call previews and sends nothing; call again with the returned confirmToken.",
  mode: "bot",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  inputSchema: {
    chatId: z.string().min(1).describe("Target chat: numeric chat id or @channelusername."),
    text: z.string().min(1).describe("Message text shown above the buttons."),
    buttons: z
      .array(z.array(buttonSchema).min(1))
      .min(1)
      .describe("Rows of buttons: an array of rows, each row an array of buttons."),
    confirmToken: z
      .string()
      .optional()
      .describe("Omit to preview. Pass the token from the preview to actually send."),
  },
  async handler({ chatId, text, buttons, confirmToken }) {
    const cid = normalizeChatId(chatId);
    const sig = signature({ action: "send_inline_keyboard", chatId, text, buttons });

    if (!confirmToken) {
      return okJson(
        buildPreview("send_inline_keyboard", { chatId: cid }, { text, buttons }, sig),
      );
    }

    consumeConfirmation(confirmToken, sig);

    const inline_keyboard = buttons.map((row) =>
      row.map((b) => ({ text: b.text, callback_data: b.callbackData })),
    );

    await botLimiter.acquire(String(cid));
    const result = await callBot<SentMessage>("sendMessage", {
      chat_id: cid,
      text,
      reply_markup: { inline_keyboard },
    });

    return okJson({
      status: "sent",
      messageId: result.message_id,
      chatId: cid,
      date: result.date,
      hint: "Use handle_callback to receive taps on these buttons.",
    });
  },
});
