/**
 * get_bot_info — return the bot account's own info (Bot API getMe). Read-only.
 * The bot-mode parallel to get_me; useful to confirm the token works.
 */

import { callBot } from "../client/bot.js";
import { botLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { defineTool } from "./registry.js";

interface BotUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

export const getBotInfoTool = defineTool({
  name: "get_bot_info",
  title: "Get Bot Info",
  description:
    "Return information about the authenticated bot (Bot API mode): id, name, " +
    "username, and capability flags. Read-only. Use this to confirm the bot token.",
  mode: "bot",
  annotations: { readOnlyHint: true },
  inputSchema: {},
  async handler() {
    await botLimiter.acquire("get_bot_info");
    const me = await callBot<BotUser>("getMe");
    return okJson({
      id: me.id,
      isBot: me.is_bot,
      firstName: me.first_name,
      username: me.username ?? null,
      canJoinGroups: me.can_join_groups ?? null,
      canReadAllGroupMessages: me.can_read_all_group_messages ?? null,
      supportsInlineQueries: me.supports_inline_queries ?? null,
    });
  },
});
