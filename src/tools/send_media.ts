/**
 * send_media — send a photo / video / audio / file as the USER (MTProto).
 * WRITE tool, confirm-guarded. Closes the most-requested gap (we could only
 * download media before).
 *
 * `file` may be a local path or an http(s) URL (fetched then uploaded). gramjs
 * auto-detects the media type; `asDocument` forces a plain-file attachment.
 */

import { z } from "zod";
import { basename } from "node:path";
import { CustomFile } from "telegram/client/uploads.js";
import { getMtprotoClient } from "../client/mtproto.js";
import { mtprotoLimiter } from "../lib/ratelimit.js";
import { okJson, fail } from "../lib/errors.js";
import { resolveEntity, describePeer, peerKey } from "../lib/entities.js";
import { toIso } from "../lib/format.js";
import { chatRef } from "../lib/schemas.js";
import { signature, consumeConfirmation, buildPreview } from "../lib/confirm.js";
import { defineTool } from "./registry.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function resolveFile(file: string): Promise<string | CustomFile> {
  if (!/^https?:\/\//i.test(file)) return file; // local path — gramjs reads it
  // Remote URL: fetch into memory and wrap as an uploadable file.
  const res = await fetch(file, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Failed to fetch ${file} (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  const name = basename(new URL(file).pathname) || "file.bin";
  return new CustomFile(name, buf.length, "", buf);
}

export const sendMediaTool = defineTool({
  name: "send_media",
  title: "Send Media",
  description:
    "Send a photo, video, audio, or file to a chat as your user account. `file` is " +
    "a local path or an http(s) URL. Guarded: the first call previews and sends " +
    "nothing; call again with the returned confirmToken to send.",
  mode: "mtproto",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  inputSchema: {
    chat: chatRef,
    file: z.string().min(1).describe("Local file path or http(s) URL of the media to send."),
    caption: z.string().optional().describe("Optional caption text."),
    asDocument: z
      .boolean()
      .optional()
      .default(false)
      .describe("Send as a plain file attachment instead of inline photo/video."),
    replyToMsgId: z.number().int().positive().optional().describe("Message id to reply to."),
    confirmToken: z
      .string()
      .optional()
      .describe("Omit to preview. Pass the token from the preview to actually send."),
  },
  async handler({ chat, file, caption, asDocument, replyToMsgId, confirmToken }) {
    const client = await getMtprotoClient();
    const entity = await resolveEntity(client, chat);
    const recipient = describePeer(entity);

    const sig = signature({
      action: "send_media",
      chat,
      file,
      caption: caption ?? null,
      asDocument,
      replyToMsgId: replyToMsgId ?? null,
    });

    if (!confirmToken) {
      return okJson(
        buildPreview(
          "send_media",
          recipient,
          { file, caption: caption ?? null, asDocument },
          sig,
        ),
      );
    }

    consumeConfirmation(confirmToken, sig);

    const toSend = await resolveFile(file);
    await mtprotoLimiter.acquire(peerKey(entity));
    const sent = (await client.sendFile(entity, {
      file: toSend as any,
      caption,
      forceDocument: asDocument,
      ...(replyToMsgId !== undefined ? { replyTo: replyToMsgId } : {}),
    })) as { id: number; date?: number };

    if (!sent) return fail("Send appeared to fail (no message returned).");

    return okJson({
      status: "sent",
      messageId: sent.id,
      recipient,
      date: toIso(sent.date),
    });
  },
});
