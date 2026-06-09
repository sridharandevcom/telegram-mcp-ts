/**
 * handle_callback — receive inline-keyboard button taps (Bot API). Read-ish:
 * it long-polls for callback_query updates for a bounded window, acknowledges
 * each (so the button stops showing a spinner), and returns what was tapped.
 *
 * This is the "running update listener" from the plan, scoped to a single
 * bounded call so it fits the request/response model of an MCP tool.
 *
 * Note: getUpdates and webhooks are mutually exclusive. Don't use this if the
 * bot has a webhook configured.
 */

import { z } from "zod";
import { getBotUpdates, answerCallbackQuery } from "../client/bot.js";
import { botLimiter } from "../lib/ratelimit.js";
import { okJson } from "../lib/errors.js";
import { defineTool } from "./registry.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const handleCallbackTool = defineTool({
  name: "handle_callback",
  title: "Bot: Handle Button Taps",
  description:
    "Listen for inline-keyboard button taps for up to timeoutSeconds, acknowledge " +
    "each, and return the callback data received. Call this after send_inline_keyboard " +
    "to see which buttons users pressed. (Do not use if the bot uses a webhook.)",
  mode: "bot",
  annotations: { readOnlyHint: false, openWorldHint: true },
  inputSchema: {
    timeoutSeconds: z
      .number()
      .int()
      .positive()
      .max(60)
      .optional()
      .default(30)
      .describe("How long to wait for taps (1-60s, default 30)."),
    answerText: z
      .string()
      .max(200)
      .optional()
      .describe("Optional toast shown to the user when their tap is acknowledged."),
  },
  async handler({ timeoutSeconds, answerText }) {
    await botLimiter.acquire("getUpdates");
    const updates = await getBotUpdates({
      timeoutSeconds,
      allowedUpdates: ["callback_query"],
    });

    const callbacks: Array<Record<string, unknown>> = [];
    let ackFailures = 0;
    for (const u of updates) {
      const cq = u.callback_query;
      if (!cq) continue;

      // Acknowledge, but never let one stale/expired callback ("query is too old")
      // abort the whole batch — record the tap data regardless of ack success.
      let acknowledged = false;
      let ackError: string | undefined;
      try {
        await answerCallbackQuery(cq.id, answerText);
        acknowledged = true;
      } catch (err) {
        ackError = err instanceof Error ? err.message : String(err);
        ackFailures += 1;
      }

      const from = cq.from ?? {};
      callbacks.push({
        callbackData: cq.data ?? null,
        from: {
          id: from.id ?? null,
          username: from.username ?? null,
          name: [from.first_name, from.last_name].filter(Boolean).join(" ") || null,
        },
        messageId: cq.message?.message_id ?? null,
        chatId: cq.message?.chat?.id ?? null,
        acknowledged,
        ...(ackError ? { ackError } : {}),
      });
    }

    return okJson({
      polledSeconds: timeoutSeconds,
      callbacksReceived: callbacks.length,
      ackFailures,
      callbacks,
    });
  },
});
