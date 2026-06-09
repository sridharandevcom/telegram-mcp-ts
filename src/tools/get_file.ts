/**
 * get_file — download a file the bot received (by file_id) to local disk.
 * Read-ish (only writes locally). Complements MTProto download_media.
 */

import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { join, isAbsolute, basename } from "node:path";
import { callBot, botFileDownloadUrl } from "../client/bot.js";
import { botLimiter } from "../lib/ratelimit.js";
import { okJson, fail } from "../lib/errors.js";
import { defineTool } from "./registry.js";

interface FileInfo {
  file_id: string;
  file_size?: number;
  file_path?: string;
}

export const getFileTool = defineTool({
  name: "get_file",
  title: "Bot: Download File",
  description:
    "Download a file the bot received (by file_id, e.g. from an incoming message) " +
    "to a local folder. Returns the saved path and size.",
  mode: "bot",
  annotations: { readOnlyHint: true },
  inputSchema: {
    fileId: z.string().min(1).describe("Telegram file_id to download."),
    outputDir: z.string().optional().describe("Folder to save into (default ./downloads)."),
  },
  async handler({ fileId, outputDir }) {
    await botLimiter.acquire("get_file");
    const info = await callBot<FileInfo>("getFile", { file_id: fileId });
    if (!info.file_path) return fail("Telegram did not return a file_path (file too large or expired?).");

    const res = await fetch(botFileDownloadUrl(info.file_path), { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) return fail(`Download failed (HTTP ${res.status}).`);
    const buf = Buffer.from(await res.arrayBuffer());

    const dir = outputDir
      ? isAbsolute(outputDir)
        ? outputDir
        : join(process.cwd(), outputDir)
      : join(process.cwd(), "downloads");
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, basename(info.file_path));
    await writeFile(filePath, buf);

    return okJson({ status: "downloaded", file: filePath, bytes: buf.length, fileId });
  },
});
