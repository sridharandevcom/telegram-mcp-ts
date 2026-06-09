/**
 * join_chat — join a public channel/group by @username, or a private one by
 * invite link. WRITE tool.
 *
 * Account-safety: joining many chats quickly is a ban trigger, so this runs under
 * a dedicated throttle key (every join is spaced out by the rate limiter).
 */

import { z } from "zod";
import { Api } from "telegram";
import { getMtprotoClient } from "../client/mtproto.js";
import { mtprotoLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { resolveEntity, describePeer } from "../lib/entities.js";
import { defineTool } from "./registry.js";

/** Extract a private-invite hash from a t.me/+HASH or joinchat/HASH link, else null. */
function inviteHash(target: string): string | null {
  const m = target.match(/(?:t\.me\/|telegram\.me\/)?(?:joinchat\/|\+)([A-Za-z0-9_-]+)/i);
  return m ? (m[1] ?? null) : null;
}

export const joinChatTool = defineTool({
  name: "join_chat",
  title: "Join Chat",
  description:
    "Join a public channel/group by @username, or a private one via its invite " +
    "link (t.me/+… or joinchat/…). Heavily rate-limited — joining many chats " +
    "quickly can get an account restricted.",
  mode: "mtproto",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  inputSchema: {
    target: z
      .string()
      .min(1)
      .describe("@username of a public chat, or a private invite link (t.me/+… / joinchat/…)."),
  },
  async handler({ target }) {
    const client = await getMtprotoClient();
    await mtprotoLimiter.acquire("join_chat"); // single key → joins are serialized/spaced

    const hash = inviteHash(target);
    if (hash) {
      const updates: any = await client.invoke(new Api.messages.ImportChatInvite({ hash }));
      const chat = updates?.chats?.[0];
      return okJson({
        status: "joined",
        via: "invite_link",
        chat: chat ? describePeer(chat) : { id: null, name: target, type: "unknown" },
      });
    }

    const entity = await resolveEntity(client, target);
    await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
    return okJson({ status: "joined", via: "username", chat: describePeer(entity) });
  },
});
