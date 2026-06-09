/**
 * Error handling helpers.
 *
 * Never throw raw errors to the MCP client. Every tool
 * handler funnels failures through here and returns a structured, human-readable
 * string instead.
 */

import { z } from "zod";

/**
 * A tool result in MCP's content shape. The index signature mirrors the SDK's
 * CallToolResult (which allows `_meta` and other passthrough keys) so our typed
 * results are assignable where the SDK expects them.
 */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

/** Build a successful text result. */
export function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

/** Build a successful result from a JSON-serializable value (pretty-printed).
 *  Telegram ids are often BigInt / big-integer; stringify them safely. */
export function okJson(value: unknown): ToolResult {
  return ok(
    JSON.stringify(
      value,
      (_key, val) => (typeof val === "bigint" ? val.toString() : val),
      2,
    ),
  );
}

/** Build an error result (never throws past the tool boundary). */
export function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Turn a thrown value (Error, gramjs RPCError, string, anything) into a single
 * clean line of text. Strips noisy stack traces but keeps the useful message.
 */
export function describeError(err: unknown): string {
  if (err instanceof z.ZodError) {
    const issues = err.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return `Invalid input — ${issues}`;
  }
  if (err instanceof Error) {
    // gramjs RPCErrors expose errorMessage / code; surface them if present.
    const anyErr = err as Error & { errorMessage?: string; code?: number };
    if (anyErr.errorMessage) {
      const code = anyErr.code ? ` (code ${anyErr.code})` : "";
      return `Telegram error: ${anyErr.errorMessage}${code}`;
    }
    return err.message;
  }
  if (typeof err === "string") return err;
  return `Unknown error: ${String(err)}`;
}

/**
 * Wrap an async tool body so any throw becomes a structured error result.
 * Validates `input` against `schema` first, then runs `fn`.
 */
export async function runTool<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
  input: unknown,
  fn: (args: z.infer<z.ZodObject<Shape>>) => Promise<ToolResult>,
): Promise<ToolResult> {
  let parsed: z.infer<z.ZodObject<Shape>>;
  try {
    parsed = schema.parse(input ?? {});
  } catch (err) {
    return fail(describeError(err));
  }

  try {
    return await fn(parsed);
  } catch (err) {
    return fail(describeError(err));
  }
}
