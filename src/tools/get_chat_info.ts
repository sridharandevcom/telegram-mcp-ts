/**
 * get_chat_info — read info about a chat as the bot (Bot API getChat +
 * member count). Read-only.
 */

import { z } from "zod";
import { callBot, normalizeChatId } from "../client/bot.js";
import { botLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { defineTool } from "./registry.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const getChatInfoTool = defineTool({
  name: "get_chat_info",
  title: "Bot: Get Chat Info",
  description:
    "Get information about a chat the bot can see: title, type, description, and " +
    "member count. Read-only.",
  mode: "bot",
  annotations: { readOnlyHint: true },
  inputSchema: {
    chatId: z.string().min(1).describe("Chat id or @username."),
  },
  async handler({ chatId }) {
    const cid = normalizeChatId(chatId);
    await botLimiter.acquire(String(cid));
    const chat = await callBot<any>("getChat", { chat_id: cid });
    let memberCount: number | null = null;
    try {
      memberCount = await callBot<number>("getChatMemberCount", { chat_id: cid }, { retry: false });
    } catch {
      memberCount = null; // not available for all chat types
    }
    return okJson({
      id: chat.id,
      type: chat.type,
      title: chat.title ?? null,
      username: chat.username ?? null,
      description: chat.description ?? null,
      memberCount,
    });
  },
});
