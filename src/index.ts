/**
 * telegram-mcp-ts — entrypoint.
 *
 * Starts an MCP server (stdio or HTTP), detects which mode(s) are enabled from
 * the environment, and registers the matching tools. To add a tool: create its
 * file under tools/ and add it to the `ALL_TOOLS` array.
 */

import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { detectModes, getMetaMode, getTransportConfig } from "./lib/config.js";
import { registerTools, registerMetaTools, type AnyTool } from "./tools/registry.js";
import { startHttpServer } from "./transport.js";
import { disconnectMtprotoClient } from "./client/mtproto.js";

import { getMeTool } from "./tools/get_me.js";
import { getDialogsTool } from "./tools/get_dialogs.js";
import { getMessagesTool } from "./tools/get_messages.js";
import { sendMessageTool } from "./tools/send_message.js";
import { editMessageTool } from "./tools/edit_message.js";
import { deleteMessageTool } from "./tools/delete_message.js";
import { markAsReadTool } from "./tools/mark_as_read.js";
import { searchMessagesTool } from "./tools/search_messages.js";
import { downloadMediaTool } from "./tools/download_media.js";
import { getUnreadSummaryTool } from "./tools/get_unread_summary.js";
import { sendScheduledTool } from "./tools/send_scheduled.js";
import { getTopicMessagesTool } from "./tools/get_topic_messages.js";
import { replyToTopicTool } from "./tools/reply_to_topic.js";
import { sendMediaTool } from "./tools/send_media.js";
import { joinChatTool } from "./tools/join_chat.js";
import { leaveChatTool } from "./tools/leave_chat.js";
// Bot API tools (isolated module, enabled only with TELEGRAM_BOT_TOKEN)
import { getBotInfoTool } from "./tools/get_bot_info.js";
import { sendBotMessageTool } from "./tools/send_bot_message.js";
import { sendDocumentTool } from "./tools/send_document.js";
import { sendPollTool } from "./tools/send_poll.js";
import { sendInlineKeyboardTool } from "./tools/send_inline_keyboard.js";
import { handleCallbackTool } from "./tools/handle_callback.js";
import { sendBotMediaTool } from "./tools/send_bot_media.js";
import { sendMediaGroupTool } from "./tools/send_media_group.js";
import { editBotMessageTool } from "./tools/edit_bot_message.js";
import { deleteBotMessageTool } from "./tools/delete_bot_message.js";
import { forwardMessageTool } from "./tools/forward_message.js";
import { copyMessageTool } from "./tools/copy_message.js";
import { sendChatActionTool } from "./tools/send_chat_action.js";
import { getFileTool } from "./tools/get_file.js";
import { getChatInfoTool } from "./tools/get_chat_info.js";
import { runDoctor } from "./lib/doctor.js";

/** Every tool in the project. Registration is filtered by enabled mode. */
const ALL_TOOLS: AnyTool[] = [
  // --- MTProto (user account) ---
  getMeTool,
  getDialogsTool,
  getMessagesTool,
  searchMessagesTool,
  sendMessageTool,
  editMessageTool,
  deleteMessageTool,
  markAsReadTool,
  downloadMediaTool,
  getUnreadSummaryTool,
  sendScheduledTool,
  getTopicMessagesTool,
  replyToTopicTool,
  sendMediaTool,
  joinChatTool,
  leaveChatTool,
  // --- Bot API ---
  getBotInfoTool,
  sendBotMessageTool,
  sendDocumentTool,
  sendPollTool,
  sendInlineKeyboardTool,
  handleCallbackTool,
  sendBotMediaTool,
  sendMediaGroupTool,
  editBotMessageTool,
  deleteBotMessageTool,
  forwardMessageTool,
  copyMessageTool,
  sendChatActionTool,
  getFileTool,
  getChatInfoTool,
];

const SERVER_NAME = "telegram-mcp-ts";
const SERVER_VERSION = "0.7.0";

/* ---- Public type exports (full TypeScript types are a shipped feature) ---- */
export type { ToolResult } from "./lib/errors.js";
export type { ToolDefinition, AnyTool } from "./tools/registry.js";
export type { Mode, MtprotoConfig } from "./lib/config.js";
export type { MessageView } from "./lib/format.js";
export type { MeInfo } from "./tools/get_me.js";
export { detectModes } from "./lib/config.js";

async function main(): Promise<void> {
  const modes = detectModes();

  if (modes.length === 0) {
    // stderr is safe; stdout is reserved for the JSON-RPC transport.
    process.stderr.write(
      "[telegram-mcp-ts] No credentials found. Set TELEGRAM_API_ID + TELEGRAM_API_HASH " +
        "(MTProto) and/or TELEGRAM_BOT_TOKEN (Bot API). Starting with no tools.\n",
    );
  }

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  const metaMode = getMetaMode();
  const registered = metaMode
    ? registerMetaTools(server, ALL_TOOLS, modes)
    : registerTools(server, ALL_TOOLS, modes);
  process.stderr.write(
    `[telegram-mcp-ts] modes=[${modes.join(", ") || "none"}] ` +
      `${metaMode ? "meta-mode " : ""}tools=[${registered.join(", ") || "none"}]\n`,
  );

  const transportCfg = getTransportConfig();
  if (transportCfg.kind === "http") {
    await startHttpServer(server, transportCfg.port, transportCfg.host);
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write("[telegram-mcp-ts] server ready on stdio\n");
  }

  const shutdown = async () => {
    await disconnectMtprotoClient();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Only start the server when run directly (e.g. `npx telegram-mcp-ts` / the bin),
// not when imported as a library for its exported types.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const command = process.argv[2];
  if (command === "doctor") {
    runDoctor()
      .then((code) => process.exit(code))
      .catch((err) => {
        process.stderr.write(`[telegram-mcp-ts] doctor failed: ${String(err)}\n`);
        process.exit(1);
      });
  } else {
    main().catch((err) => {
      process.stderr.write(`[telegram-mcp-ts] fatal: ${String(err)}\n`);
      process.exit(1);
    });
  }
}
