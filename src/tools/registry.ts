/**
 * Single registration interface for all tools (one tool per file,
 * registered through one interface).
 *
 * Each tool file exports a `ToolDefinition`. The registry collects them, filters
 * by which modes are enabled, and registers each on the McpServer. Adding a tool
 * = create a file + add it to the array in `index.ts`. Nothing else changes.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Mode } from "../lib/config.js";
import { runTool, okJson, fail, type ToolResult } from "../lib/errors.js";

/**
 * MCP tool annotations (behavioral hints clients can surface, e.g. warn before a
 * destructive call). All optional; mirror the MCP spec's ToolAnnotations.
 */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * A tool definition decoupled from the MCP SDK surface.
 *
 * `inputSchema` is a zod *raw shape* (a plain object of zod types). The SDK's
 * registerTool takes the same shape and uses it to advertise the JSON schema to
 * clients; we also build a ZodObject from it to validate at runtime.
 */
export interface ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  /** Unique tool name exposed to the client, e.g. "get_me". */
  name: string;
  /** Short human title for UIs. */
  title: string;
  /** What the tool does, written for an LLM to read. */
  description: string;
  /** Which mode this tool belongs to. Determines whether it is registered. */
  mode: Mode;
  /** zod raw shape describing the inputs ({} for no inputs). */
  inputSchema: Shape;
  /** Optional behavioral hints (read-only / destructive / etc.) for clients. */
  annotations?: ToolAnnotations;
  /** Handler receiving validated, typed args. */
  handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<ToolResult>;
}

/** Helper to define a tool with full type inference on the handler args. */
export function defineTool<Shape extends z.ZodRawShape>(
  def: ToolDefinition<Shape>,
): ToolDefinition<Shape> {
  return def;
}

/**
 * Type-erased tool, used for collections that hold tools of differing input
 * shapes. Each tool keeps its own precise types internally (via defineTool);
 * this alias only relaxes the shared container/handler so a heterogeneous list
 * type-checks. The `any` is deliberate and contained to this boundary.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolDefinition<any>;

/**
 * Register every tool whose mode is enabled. Returns the names registered so the
 * server can log/report them.
 */
export function registerTools(
  server: McpServer,
  tools: AnyTool[],
  enabledModes: Mode[],
): string[] {
  const registered: string[] = [];

  for (const tool of tools) {
    if (!enabledModes.includes(tool.mode)) continue;

    const schema = z.object(tool.inputSchema);

    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      },
      // The SDK passes already-parsed args, but we re-validate through runTool so
      // every tool gets uniform zod validation + structured error wrapping.
      async (args: unknown) => runTool(schema, args, tool.handler),
    );

    registered.push(tool.name);
  }

  return registered;
}

/**
 * Meta-mode (lazy tool loading): instead of registering every tool, register two
 * meta-tools that let a client discover and invoke the rest on demand. Keeps the
 * client's tool list tiny when the underlying surface is large.
 */
export function registerMetaTools(
  server: McpServer,
  tools: AnyTool[],
  enabledModes: Mode[],
): string[] {
  const available = tools.filter((t) => enabledModes.includes(t.mode));
  const byName = new Map(available.map((t) => [t.name, t]));

  server.registerTool(
    "list_tools",
    {
      title: "List Telegram Tools",
      description:
        "List every available Telegram tool with its description, input JSON schema, " +
        "and annotations. Call this first, then use call_tool to invoke one.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      okJson({
        count: available.length,
        tools: available.map((t) => ({
          name: t.name,
          mode: t.mode,
          description: t.description,
          annotations: t.annotations ?? {},
          inputSchema: zodToJsonSchema(z.object(t.inputSchema), { target: "jsonSchema7" }),
        })),
      }),
  );

  server.registerTool(
    "call_tool",
    {
      title: "Call a Telegram Tool",
      description:
        "Invoke one of the tools returned by list_tools. Pass its name and an " +
        "arguments object matching that tool's input schema.",
      inputSchema: {
        name: z.string().min(1).describe("The tool name (from list_tools)."),
        arguments: z
          .record(z.unknown())
          .optional()
          .describe("Arguments object matching the tool's input schema."),
      },
    },
    async (args: unknown) => {
      const parsed = z
        .object({ name: z.string().min(1), arguments: z.record(z.unknown()).optional() })
        .safeParse(args);
      if (!parsed.success) return fail(`Invalid call_tool input — ${parsed.error.issues[0]?.message}`);

      const target = byName.get(parsed.data.name);
      if (!target) {
        return fail(
          `Unknown tool "${parsed.data.name}". Call list_tools to see available tools.`,
        );
      }
      const schema = z.object(target.inputSchema);
      return runTool(schema, parsed.data.arguments ?? {}, target.handler);
    },
  );

  return ["list_tools", "call_tool"];
}
