/**
 * download_media — download the media/file attached to a message.
 *
 * Fetches the message by id, verifies it has
 * media, downloads to a local file, and returns the path + size. Read-only with
 * respect to Telegram (it only writes to your local disk).
 */

import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { Api } from "telegram";
import { getMtprotoClient } from "../client/mtproto.js";
import { mtprotoLimiter } from "../lib/ratelimit.js";
import { okJson, fail } from "../lib/errors.js";
import { resolveEntity, describePeer, peerKey } from "../lib/entities.js";
import { mediaLabel } from "../lib/format.js";
import { chatRef, messageIdField } from "../lib/schemas.js";
import { defineTool } from "./registry.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Best-effort filename for the downloaded media. */
function guessFilename(msg: any): string {
  const media = msg?.media;
  const doc = media?.document;
  if (doc?.attributes) {
    for (const attr of doc.attributes) {
      if (attr instanceof Api.DocumentAttributeFilename && attr.fileName) {
        return attr.fileName;
      }
    }
  }
  if (media?.className === "MessageMediaPhoto") return `photo_${msg.id}.jpg`;
  if (doc?.mimeType === "image/jpeg") return `image_${msg.id}.jpg`;
  if (doc?.mimeType === "video/mp4") return `video_${msg.id}.mp4`;
  return `media_${msg.id}.bin`;
}

export const downloadMediaTool = defineTool({
  name: "download_media",
  title: "Download Media",
  description:
    "Download the media/file attached to a specific message to a local folder. " +
    "Returns the saved file path and size. Only writes to your local disk.",
  mode: "mtproto",
  annotations: { readOnlyHint: true },
  inputSchema: {
    chat: chatRef,
    messageId: messageIdField,
    outputDir: z
      .string()
      .optional()
      .describe("Folder to save into (default: ./downloads under the server's cwd)."),
  },
  async handler({ chat, messageId, outputDir }) {
    const client = await getMtprotoClient();
    const entity = await resolveEntity(client, chat);

    await mtprotoLimiter.acquire(peerKey(entity));
    const messages = await client.getMessages(entity, { ids: [messageId] });
    const msg = messages[0];

    if (!msg) return fail(`Message ${messageId} not found in that chat.`);
    if (!msg.media) return fail(`Message ${messageId} has no downloadable media.`);

    const dir = outputDir
      ? isAbsolute(outputDir)
        ? outputDir
        : join(process.cwd(), outputDir)
      : join(process.cwd(), "downloads");
    await mkdir(dir, { recursive: true });

    const buffer = (await client.downloadMedia(msg, {})) as Buffer | undefined;
    if (!buffer || buffer.length === 0) {
      return fail(`Failed to download media from message ${messageId} (empty result).`);
    }

    const filePath = join(dir, guessFilename(msg));
    await writeFile(filePath, buffer);

    return okJson({
      ok: true,
      file: filePath,
      bytes: buffer.length,
      media: mediaLabel(msg.media),
      chat: describePeer(entity),
      messageId,
    });
  },
});
