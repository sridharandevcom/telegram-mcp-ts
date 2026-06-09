/**
 * send_document — send a file as the bot (Bot API). WRITE tool, confirm-guarded.
 *
 * The `document` may be a public URL, a Telegram file_id, or a local file path.
 * Local files are uploaded via multipart/form-data; URLs/file_ids are passed
 * straight through.
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

async function isLocalFile(p: string): Promise<boolean> {
  if (/^https?:\/\//i.test(p)) return false;
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

export const sendDocumentTool = defineTool({
  name: "send_document",
  title: "Bot: Send Document",
  description:
    "Send a file/document as the bot. `document` can be a public URL, a Telegram " +
    "file_id, or a local file path (uploaded). Guarded: first call previews and " +
    "sends nothing; call again with the returned confirmToken to send.",
  mode: "bot",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  inputSchema: {
    chatId: z.string().min(1).describe("Target chat: numeric chat id or @channelusername."),
    document: z
      .string()
      .min(1)
      .describe("Public URL, Telegram file_id, or local file path."),
    caption: z.string().optional().describe("Optional caption text."),
    confirmToken: z
      .string()
      .optional()
      .describe("Omit to preview. Pass the token from the preview to actually send."),
  },
  async handler({ chatId, document, caption, confirmToken }) {
    const cid = normalizeChatId(chatId);
    const local = await isLocalFile(document);
    const sig = signature({
      action: "send_document",
      chatId,
      document,
      caption: caption ?? null,
    });

    if (!confirmToken) {
      return okJson(
        buildPreview(
          "send_document",
          { chatId: cid },
          { document, caption: caption ?? null, upload: local ? "local-file" : "url-or-file_id" },
          sig,
        ),
      );
    }

    consumeConfirmation(confirmToken, sig);
    await botLimiter.acquire(String(cid));

    let result: SentMessage;
    if (local) {
      const buf = await readFile(document);
      const form = new FormData();
      form.append("chat_id", String(cid));
      if (caption !== undefined) form.append("caption", caption);
      form.append("document", new Blob([buf]), basename(document));
      result = await callBotMultipart<SentMessage>("sendDocument", form);
    } else {
      result = await callBot<SentMessage>("sendDocument", {
        chat_id: cid,
        document,
        caption,
      });
    }

    return okJson({ status: "sent", messageId: result.message_id, chatId: cid, date: result.date });
  },
});
