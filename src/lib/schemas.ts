/**
 * Shared zod fragments used across MTProto tools.
 * Keeping the common pieces here means every tool describes "chat" / "limit" the
 * same way to the client.
 */

import { z } from "zod";

/** How to reference a chat in any tool. */
export const chatRef = z
  .string()
  .trim()
  .min(1, "chat is required")
  .describe(
    'Chat reference: "me" (Saved Messages), an @username, or a numeric chat ID. ' +
      "For numeric IDs, call get_dialogs first so the account knows the chat.",
  );

/** A single Telegram message id (positive integer). */
export const messageIdField = z
  .number()
  .int()
  .positive()
  .describe("Telegram message id (a positive integer).");

/** A bounded result limit with a sane default. */
export const limitField = (def: number, max = 100) =>
  z
    .number()
    .int()
    .positive()
    .max(max)
    .optional()
    .default(def)
    .describe(`Max items to return (1-${max}, default ${def}).`);
