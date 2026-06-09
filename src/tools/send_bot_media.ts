/**
 * send_bot_media — send a photo/video/audio/voice/animation as the bot (Bot API).
 * WRITE tool, confirm-guarded. `media` may be a URL, file_id, or local path.
 */

import { z } from "zod";
import { stat, readFile } from "node:fs/promises";
import { basename } from "node:path";
import { callBot, callBotMultipart, normalizeChatId } from "../client/bot.js";
import { botLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { signature, consumeConfirmation, buildPreview } from "../lib/confirm.js";
import { defineTool } from "./registry.js";

interface SentMessage {
  message_id: number;
  date: number;
}

const METHOD: Record<string, { method: string; field: string }> = {
  photo: { method: "sendPhoto", field: "photo" },
  video: { method: "sendVideo", field: "video" },
  audio: { method: "sendAudio", field: "audio" },
  voice: { method: "sendVoice", field: "voice" },
  animation: { method: "sendAnimation", field: "animation" },
};

async function isLocalFile(p: string): Promise<boolean> {
  if (/^https?:\/\//i.test(p)) return false;
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

export const sendBotMediaTool = defineTool({
  name: "send_bot_media",
  title: "Bot: Send Media",
  description:
    "Send a photo, video, audio, voice, or animation as the bot (shown with the " +
    "proper inline player, unlike send_document). `media` is a URL, file_id, or " +
    "local path. Guarded: preview first, then call again with confirmToken.",
  mode: "bot",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  inputSchema: {
    chatId: z.string().min(1).describe("Target chat: numeric id or @channelusername."),
    type: z.enum(["photo", "video", "audio", "voice", "animation"]).describe("Media type."),
    media: z.string().min(1).describe("URL, Telegram file_id, or local file path."),
    caption: z.string().optional().describe("Optional caption."),
    confirmToken: z.string().optional().describe("Omit to preview; pass to send."),
  },
  async handler({ chatId, type, media, caption, confirmToken }) {
    const cid = normalizeChatId(chatId);
    const sig = signature({ action: "send_bot_media", chatId, type, media, caption: caption ?? null });

    if (!confirmToken) {
      return okJson(buildPreview("send_bot_media", { chatId: cid }, { type, media, caption: caption ?? null }, sig));
    }
    consumeConfirmation(confirmToken, sig);

    const { method, field } = METHOD[type]!;
    await botLimiter.acquire(String(cid));

    let result: SentMessage;
    if (await isLocalFile(media)) {
      const buf = await readFile(media);
      const form = new FormData();
      form.append("chat_id", String(cid));
      if (caption !== undefined) form.append("caption", caption);
      form.append(field, new Blob([buf]), basename(media));
      result = await callBotMultipart<SentMessage>(method, form);
    } else {
      result = await callBot<SentMessage>(method, { chat_id: cid, [field]: media, caption });
    }

    return okJson({ status: "sent", messageId: result.message_id, chatId: cid, type });
  },
});
