/**
 * edit_message — edit the text of an existing message. WRITE tool.
 * You can only edit your own messages (Telegram restriction).
 */

import { z } from "zod";
import { getMtprotoClient } from "../client/mtproto.js";
import { mtprotoLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { resolveEntity, describePeer, peerKey } from "../lib/entities.js";
import { toIso } from "../lib/format.js";
import { chatRef, messageIdField } from "../lib/schemas.js";
import { defineTool } from "./registry.js";

export const editMessageTool = defineTool({
  name: "edit_message",
  title: "Edit Message",
  description:
    "Edit the text of an existing message you sent. WRITE action. Returns the " +
    "edited message id and new edit timestamp.",
  mode: "mtproto",
  annotations: { readOnlyHint: false, destructiveHint: false },
  inputSchema: {
    chat: chatRef,
    messageId: messageIdField,
    text: z.string().min(1, "text must not be empty").describe("New message text."),
  },
  async handler({ chat, messageId, text }) {
    const client = await getMtprotoClient();
    const entity = await resolveEntity(client, chat);

    await mtprotoLimiter.acquire(peerKey(entity));
    const edited = await client.editMessage(entity, { message: messageId, text });

    return okJson({
      ok: true,
      messageId: edited.id,
      chat: describePeer(entity),
      editDate: toIso(edited.editDate),
    });
  },
});
