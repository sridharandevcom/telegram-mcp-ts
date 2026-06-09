/**
 * send_scheduled — schedule a text message for future delivery using gramjs's
 * native scheduling. WRITE tool, guarded by the confirm-before-send pattern.
 */

import { z } from "zod";
import { getMtprotoClient } from "../client/mtproto.js";
import { mtprotoLimiter } from "../lib/ratelimit.js";
import { okJson, fail } from "../lib/errors.js";
import { resolveEntity, describePeer, peerKey } from "../lib/entities.js";
import { chatRef } from "../lib/schemas.js";
import { signature, consumeConfirmation, buildPreview } from "../lib/confirm.js";
import { defineTool } from "./registry.js";

/** Parse an ISO-8601 string or unix-seconds number into a future Date. */
function parseSchedule(scheduleAt: string): { date: Date; unix: number } | { error: string } {
  const asNumber = Number(scheduleAt);
  let date: Date;
  if (!Number.isNaN(asNumber) && /^\d+$/.test(scheduleAt.trim())) {
    date = new Date(asNumber * 1000);
  } else {
    date = new Date(scheduleAt);
  }
  if (Number.isNaN(date.getTime())) {
    return { error: `Could not parse scheduleAt "${scheduleAt}". Use ISO-8601 (e.g. 2026-06-04T09:00:00Z) or unix seconds.` };
  }
  const unix = Math.floor(date.getTime() / 1000);
  const now = Math.floor(Date.now() / 1000);
  if (unix <= now + 5) {
    return { error: `scheduleAt must be at least a few seconds in the future (got ${date.toISOString()}).` };
  }
  return { date, unix };
}

export const sendScheduledTool = defineTool({
  name: "send_scheduled",
  title: "Schedule Message",
  description:
    "Schedule a text message for future delivery (Telegram native scheduling). " +
    "Guarded: first call previews and schedules nothing; call again with the " +
    "returned confirmToken to schedule. scheduleAt is ISO-8601 or unix seconds.",
  mode: "mtproto",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  inputSchema: {
    chat: chatRef,
    text: z.string().min(1, "text must not be empty").describe("Message text to schedule."),
    scheduleAt: z
      .string()
      .min(1)
      .describe("When to send: ISO-8601 (2026-06-04T09:00:00Z) or unix seconds."),
    confirmToken: z
      .string()
      .optional()
      .describe("Omit to preview. Pass the token from the preview to actually schedule."),
  },
  async handler({ chat, text, scheduleAt, confirmToken }) {
    const parsed = parseSchedule(scheduleAt);
    if ("error" in parsed) return fail(parsed.error);

    const client = await getMtprotoClient();
    const entity = await resolveEntity(client, chat);
    const recipient = describePeer(entity);

    const sig = signature({ action: "send_scheduled", chat, text, scheduleUnix: parsed.unix });

    if (!confirmToken) {
      return okJson(
        buildPreview(
          "send_scheduled",
          recipient,
          { text, scheduleAt: parsed.date.toISOString() },
          sig,
        ),
      );
    }

    consumeConfirmation(confirmToken, sig);

    await mtprotoLimiter.acquire(peerKey(entity));
    const sent = await client.sendMessage(entity, { message: text, schedule: parsed.unix });

    return okJson({
      status: "scheduled",
      messageId: sent.id,
      recipient,
      scheduledFor: parsed.date.toISOString(),
    });
  },
});
