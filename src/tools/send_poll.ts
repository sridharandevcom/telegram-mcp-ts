/**
 * send_poll — send a poll as the bot (Bot API). WRITE tool, confirm-guarded.
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

export const sendPollTool = defineTool({
  name: "send_poll",
  title: "Bot: Send Poll",
  description:
    "Send a poll as the bot. Provide a question and 2-10 options. Guarded: first " +
    "call previews and sends nothing; call again with the returned confirmToken.",
  mode: "bot",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  inputSchema: {
    chatId: z.string().min(1).describe("Target chat: numeric chat id or @channelusername."),
    question: z.string().min(1).max(300).describe("The poll question."),
    options: z
      .array(z.string().min(1).max(100))
      .min(2, "a poll needs at least 2 options")
      .max(10, "a poll allows at most 10 options")
      .describe("Answer options (2-10)."),
    isAnonymous: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether votes are anonymous (default true)."),
    allowsMultipleAnswers: z
      .boolean()
      .optional()
      .default(false)
      .describe("Allow selecting multiple options (default false)."),
    confirmToken: z
      .string()
      .optional()
      .describe("Omit to preview. Pass the token from the preview to actually send."),
  },
  async handler({ chatId, question, options, isAnonymous, allowsMultipleAnswers, confirmToken }) {
    const cid = normalizeChatId(chatId);
    const sig = signature({
      action: "send_poll",
      chatId,
      question,
      options,
      isAnonymous,
      allowsMultipleAnswers,
    });

    if (!confirmToken) {
      return okJson(
        buildPreview(
          "send_poll",
          { chatId: cid },
          { question, options, isAnonymous, allowsMultipleAnswers },
          sig,
        ),
      );
    }

    consumeConfirmation(confirmToken, sig);

    await botLimiter.acquire(String(cid));
    const result = await callBot<SentMessage>("sendPoll", {
      chat_id: cid,
      question,
      // Bot API expects InputPollOption objects.
      options: options.map((text) => ({ text })),
      is_anonymous: isAnonymous,
      allows_multiple_answers: allowsMultipleAnswers,
    });

    return okJson({ status: "sent", messageId: result.message_id, chatId: cid, date: result.date });
  },
});
