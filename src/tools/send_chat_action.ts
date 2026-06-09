/**
 * send_chat_action — show a "typing…" / "uploading…" status as the bot.
 * Lightweight write; makes an agent feel responsive. Not confirm-guarded.
 */

import { z } from "zod";
import { callBot, normalizeChatId } from "../client/bot.js";
import { botLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { defineTool } from "./registry.js";

export const sendChatActionTool = defineTool({
  name: "send_chat_action",
  title: "Bot: Send Chat Action",
  description:
    "Show a transient status in a chat as the bot (e.g. typing, upload_photo). " +
    "Lasts ~5s or until the bot sends a message.",
  mode: "bot",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  inputSchema: {
    chatId: z.string().min(1).describe("Target chat id or @username."),
    action: z
      .enum([
        "typing",
        "upload_photo",
        "record_video",
        "upload_video",
        "record_voice",
        "upload_voice",
        "upload_document",
        "choose_sticker",
        "find_location",
        "record_video_note",
        "upload_video_note",
      ])
      .default("typing")
      .describe("The action indicator to show."),
  },
  async handler({ chatId, action }) {
    const cid = normalizeChatId(chatId);
    await botLimiter.acquire(String(cid));
    await callBot("sendChatAction", { chat_id: cid, action });
    return okJson({ status: "sent", chatId: cid, action });
  },
});
