/**
 * send_media_group — send an album (2-10 items) as the bot (Bot API).
 * WRITE tool, confirm-guarded. Items are URLs or file_ids (local-file albums are
 * not supported here to keep it simple).
 */

import { z } from "zod";
import { callBot, normalizeChatId } from "../client/bot.js";
import { botLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { signature, consumeConfirmation, buildPreview } from "../lib/confirm.js";
import { defineTool } from "./registry.js";

export const sendMediaGroupTool = defineTool({
  name: "send_media_group",
  title: "Bot: Send Album",
  description:
    "Send an album of 2-10 photos/videos as the bot. Each item is a URL or " +
    "file_id. Guarded: preview first, then call again with confirmToken.",
  mode: "bot",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  inputSchema: {
    chatId: z.string().min(1).describe("Target chat: numeric id or @channelusername."),
    items: z
      .array(
        z.object({
          type: z.enum(["photo", "video"]).describe("Item type."),
          media: z.string().min(1).describe("URL or file_id."),
          caption: z.string().optional(),
        }),
      )
      .min(2, "an album needs at least 2 items")
      .max(10, "an album allows at most 10 items"),
    confirmToken: z.string().optional().describe("Omit to preview; pass to send."),
  },
  async handler({ chatId, items, confirmToken }) {
    const cid = normalizeChatId(chatId);
    const sig = signature({ action: "send_media_group", chatId, items });

    if (!confirmToken) {
      return okJson(buildPreview("send_media_group", { chatId: cid }, { items }, sig));
    }
    consumeConfirmation(confirmToken, sig);

    await botLimiter.acquire(String(cid));
    const result = await callBot<Array<{ message_id: number }>>("sendMediaGroup", {
      chat_id: cid,
      media: items.map((i) => ({ type: i.type, media: i.media, caption: i.caption })),
    });

    return okJson({ status: "sent", count: result.length, messageIds: result.map((m) => m.message_id), chatId: cid });
  },
});
