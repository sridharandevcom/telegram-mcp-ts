/**
 * leave_chat — leave a channel/supergroup or a basic group. WRITE tool.
 *
 * Confirm-guarded: leaving is only partly reversible (you can rejoin a public
 * chat, but rejoining a private channel/group needs a fresh invite), so the first
 * call previews and the second confirms.
 */

import { z } from "zod";
import { Api } from "telegram";
import { getMtprotoClient } from "../client/mtproto.js";
import { mtprotoLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { resolveEntity, describePeer, entityType, peerKey } from "../lib/entities.js";
import { chatRef } from "../lib/schemas.js";
import { signature, consumeConfirmation, buildPreview } from "../lib/confirm.js";
import { defineTool } from "./registry.js";

export const leaveChatTool = defineTool({
  name: "leave_chat",
  title: "Leave Chat",
  description:
    "Leave a channel/supergroup or basic group. Guarded: the first call previews " +
    "the chat you'd leave and does nothing; call again with the returned confirmToken " +
    "to leave. Use get_dialogs to find the chat reference if needed.",
  mode: "mtproto",
  annotations: { readOnlyHint: false, destructiveHint: true },
  inputSchema: {
    chat: chatRef,
    confirmToken: z
      .string()
      .optional()
      .describe("Omit to preview. Pass the token from the preview to actually leave."),
  },
  async handler({ chat, confirmToken }) {
    const client = await getMtprotoClient();
    const entity = await resolveEntity(client, chat);
    const recipient = describePeer(entity);

    const sig = signature({ action: "leave_chat", chat });
    if (!confirmToken) {
      const caution =
        "Leaving is reversible for public chats, but rejoining a PRIVATE channel/group " +
        "requires a fresh invite link.";
      return okJson(buildPreview("leave_chat", recipient, { leaving: recipient }, sig, caution));
    }

    consumeConfirmation(confirmToken, sig);
    await mtprotoLimiter.acquire(peerKey(entity));

    const kind = entityType(entity);
    if (kind === "channel" || (kind === "group" && (entity as { className?: string }).className === "Channel")) {
      // Channels and supergroups (Channel with megagroup) leave via LeaveChannel.
      await client.invoke(new Api.channels.LeaveChannel({ channel: entity }));
    } else {
      // Basic group (Chat) — remove self.
      await client.invoke(
        new Api.messages.DeleteChatUser({
          // gramjs entity.id is a big-integer (BigInteger), which DeleteChatUser expects.
          chatId: (entity as { id: never }).id,
          userId: new Api.InputUserSelf(),
        }),
      );
    }

    return okJson({ status: "left", chat: recipient });
  },
});
