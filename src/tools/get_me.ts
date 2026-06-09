/**
 * get_me — return the authenticated account's own info.
 *
 * Smoke-test tool: proves credentials + session are valid and the
 * MTProto client can talk to Telegram. No inputs, read-only, safe.
 */

import { Api } from "telegram";
import { getMtprotoClient } from "../client/mtproto.js";
import { mtprotoLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { defineTool } from "./registry.js";

export interface MeInfo {
  id: string;
  isBot: boolean;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  phone: string | null;
  isPremium: boolean;
  languageCode: string | null;
}

export const getMeTool = defineTool({
  name: "get_me",
  title: "Get My Account",
  description:
    "Return information about the authenticated Telegram account (the logged-in " +
    "user): id, name, username, phone, and premium status. Read-only. Use this to " +
    "confirm which account the server is acting as.",
  mode: "mtproto",
  annotations: { readOnlyHint: true },
  inputSchema: {},
  async handler() {
    await mtprotoLimiter.acquire("get_me");
    const client = await getMtprotoClient();

    const me = (await client.getMe()) as Api.User;

    const info: MeInfo = {
      id: me.id.toString(),
      isBot: Boolean(me.bot),
      firstName: me.firstName ?? null,
      lastName: me.lastName ?? null,
      username: me.username ?? null,
      phone: me.phone ?? null,
      isPremium: Boolean(me.premium),
      languageCode: me.langCode ?? null,
    };

    return okJson(info);
  },
});
