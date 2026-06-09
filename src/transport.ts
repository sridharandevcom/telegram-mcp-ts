/**
 * HTTP transport — an alternative to stdio for clients that prefer a
 * network endpoint (addresses the recurring "transport selection" request).
 *
 * Uses the MCP SDK's Streamable HTTP transport over a minimal node http server.
 * stdio remains the default; HTTP is opt-in via TELEGRAM_TRANSPORT=http.
 */

import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

/** Start an MCP server over Streamable HTTP. Resolves once it's listening. */
export async function startHttpServer(
  server: McpServer,
  port: number,
  host = "127.0.0.1",
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    // Plain JSON responses (vs SSE) — simpler for most HTTP clients.
    enableJsonResponse: true,
  });
  await server.connect(transport);

  const http = createServer((req, res) => {
    void (async () => {
      try {
        const body = req.method === "POST" ? await readJsonBody(req) : undefined;
        await transport.handleRequest(req, res, body);
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
      }
    })();
  });

  await new Promise<void>((resolve) => {
    http.listen(port, host, () => {
      process.stderr.write(
        `[telegram-mcp-ts] HTTP transport listening on http://${host}:${port}/\n`,
      );
      resolve();
    });
  });
}
