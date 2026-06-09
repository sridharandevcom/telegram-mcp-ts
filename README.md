# telegram-mcp-ts

A **TypeScript-native, dual-mode** [Model Context Protocol](https://modelcontextprotocol.io) server for Telegram.

It lets an MCP client (Claude Desktop, Cursor) read and act on Telegram on your behalf — either as a **personal user account** (MTProto, via [gramjs](https://github.com/gram-js/gramjs)) or as a **bot account** (Bot API), depending on which credentials you supply.

> **Status:** 31 tools across MTProto (16) and Bot API (15) modes, with a
> confirm-before-send safety layer, an **account-ban-avoidance engine** (adaptive
> rate limiting + flood/429 backpressure + circuit breaker), and a `doctor`
> self-check. Distributed via `npx`, with full exported types.

## 🚀 Getting Started — read this first

### 👉 [**Click here for the full Step-by-Step Install & Setup Guide**](./GETTING-STARTED.md)

> The **easiest way to install this** and connect it to **Claude Desktop / Claude
> Code / Cursor** — getting credentials, configuring your client, and running your
> first test, all explained for beginners. **Start here. 👈**

---

## Install (quick reference)

Published on npm as **[`telegram-mcp-ts`](https://www.npmjs.com/package/telegram-mcp-ts)**.
Your MCP client runs it on demand — **no manual install needed**:

```bash
npx telegram-mcp-ts            # the server (your client launches this for you)
npx telegram-mcp-ts-auth login # one-time login for personal-account (MTProto) mode
```

Prefer the commands on your PATH? Install globally: `npm install -g telegram-mcp-ts`.

The rest of this README is the full reference (modes, all tools, safety, advanced flags).

## Reliability & account safety

Driving a personal account via automation can get it **banned** if it looks like
spam — the most common failure across Telegram MCP tools. This server is built to
avoid that:

- **Safe mode (default on):** conservative, jittered rate limits. Loosen with
  `TELEGRAM_SAFE_MODE=false` at your own risk.
- **Honors backpressure:** respects Telegram `FLOOD_WAIT` and Bot API `429
  retry_after` automatically, then adaptively widens its gaps.
- **Confirm-before-send + cold-contact warnings** so nothing is sent by accident.
- **Resilience:** retry-with-backoff, a circuit breaker, and auto-reconnect.
- **`doctor` self-check:**
  ```bash
  npx telegram-mcp-ts doctor      # or: node dist/index.js doctor
  ```
  Verifies Node version, credentials, session validity + connectivity, and bot token.

See **[ACCOUNT-SAFETY.md](./ACCOUNT-SAFETY.md)** for the full threat model and what
the server does about it. **Bulk/mass sending is intentionally not supported.**

---

## Requirements

- **Node.js ≥ 18.18** (developed/tested on Node 20). Node 14/16 will not work — the MCP SDK and gramjs require modern Node.
- **MTProto mode:** Telegram **API ID** + **API HASH** from <https://my.telegram.org> → *API development tools*.
- **Bot API mode:** a **bot token** from [@BotFather](https://t.me/BotFather).

You can enable either mode or both. Pick at least one.

> ⚠️ **Use a throwaway Telegram account for write testing.** Aggressive send/edit/delete carries a ban risk. The session string grants full access to whatever account you log in with — **treat it like a password** and never commit it.

---

## Quick start (zero install, via npx)

### 1. One-time auth (MTProto / user-account mode only)

Skip this if you only want Bot API mode. The login asks for your phone number, the
login code Telegram sends, and your 2FA password (if any), then prints a reusable
**session string** (the only thing written to stdout, so you can capture it):

```bash
npx telegram-mcp-ts-auth login > session.txt
```

| Command | What it does |
| --- | --- |
| `npx telegram-mcp-ts-auth login` | Interactive login; prints a reusable session string. |
| `npx telegram-mcp-ts-auth logout` | **Revokes** the session on Telegram's servers. |
| `npx telegram-mcp-ts-auth clear-session` | Explains how to forget the local session (does not revoke). |

### 2. Add to your MCP client config

**Claude Desktop** — `claude_desktop_config.json`:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**Claude Code / Cursor** — a `.mcp.json` in your project root (same `mcpServers` shape).

```json
{
  "mcpServers": {
    "telegram": {
      "command": "npx",
      "args": ["-y", "telegram-mcp-ts"],
      "env": {
        "TELEGRAM_API_ID": "1234567",
        "TELEGRAM_API_HASH": "your_api_hash_here",
        "TELEGRAM_SESSION": "the_session_string_from_login",
        "TELEGRAM_BOT_TOKEN": "123456:your_bot_token_from_botfather"
      }
    }
  }
}
```

Include only the env vars for the mode(s) you want — MTProto needs the three
`TELEGRAM_API_*`/`SESSION` vars; Bot API needs only `TELEGRAM_BOT_TOKEN`.

**Optional flags:**
- `TELEGRAM_SAFE_MODE` (default `true`) — conservative rate limits; see
  [ACCOUNT-SAFETY.md](./ACCOUNT-SAFETY.md).
- `TELEGRAM_META_MODE` (default `false`) — **lazy tool loading**: expose only
  `list_tools` + `call_tool` instead of the full surface, to save client context.
  Tools are discovered via `list_tools` and invoked via `call_tool` (same
  validation + confirm-before-send guarantees). Recommended once 30+ tools are enabled.
- `TELEGRAM_TRANSPORT` (default `stdio`) — set to `http` to serve over Streamable
  HTTP instead of stdio. Configure with `TELEGRAM_HTTP_PORT` (default `3000`) and
  `TELEGRAM_HTTP_HOST` (default `127.0.0.1`). The MCP endpoint is the server root `/`.

All tools carry MCP **annotations** (`readOnlyHint` / `destructiveHint` /
`openWorldHint`) so clients can warn before destructive actions like
`delete_message`.

Restart your client. The `telegram` server appears with the tools for whichever
mode(s) you configured.

---

## Local development (from source)

```bash
npm install
npm run build
node dist/auth/cli.js login    # local equivalent of `npx telegram-mcp-ts-auth login`
```

Then point your client config at the local build instead of npx:

```json
"command": "node",
"args": ["C:\\path\\to\\telegram-mcp\\dist\\index.js"]
```

---

## Modes

The server detects its mode from the environment:

| Env vars present | Mode enabled | Tools |
| --- | --- | --- |
| `TELEGRAM_API_ID` + `TELEGRAM_API_HASH` (+ `TELEGRAM_SESSION`) | **MTProto** (user account) | the 16 MTProto tools below |
| `TELEGRAM_BOT_TOKEN` | **Bot API** | the 15 bot tools below |

Both can be enabled at once (31 tools); the two modes share no code except the
registration interface, so a bug in one cannot affect the other.

### Bot API setup

1. Create a bot with [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.
2. Set `TELEGRAM_BOT_TOKEN` in your config's `env` block (no login/session needed — the
   token *is* the credential).
3. Restart. The `get_bot_info` / `send_bot_*` tools appear automatically.

---

## Tools

| Tool | Mode | Kind | Description |
| --- | --- | --- | --- |
| `get_me` | MTProto | read | Authenticated account info (id, name, username, phone, premium). |
| `get_dialogs` | MTProto | read | List chats/groups/channels with IDs, unread counts, last-message preview. |
| `get_messages` | MTProto | read | Read message history from a chat (paginated via `offsetId`). |
| `search_messages` | MTProto | read | Search messages within a chat, or globally if `chat` is omitted. |
| `send_message` | MTProto | **write** | Send a text message (optional reply). **Confirm-guarded** (see below). |
| `edit_message` | MTProto | **write** | Edit the text of one of your messages. |
| `delete_message` | MTProto | **write** | Delete one or more messages (destructive; `revoke` by default). |
| `mark_as_read` | MTProto | write | Mark a chat's messages as read (non-destructive). |
| `download_media` | MTProto | read | Download a message's media/file to local disk. |
| `get_unread_summary` | MTProto | read | Compact, AI-friendly digest of unread messages grouped by chat. |
| `send_scheduled` | MTProto | **write** | Schedule a message for future delivery. **Confirm-guarded.** |
| `get_topic_messages` | MTProto | read | Read messages from a forum topic in a supergroup. |
| `reply_to_topic` | MTProto | **write** | Post into a specific forum topic. **Confirm-guarded.** |
| `send_media` | MTProto | **write** | Send a photo/video/audio/file as your account (local path or URL). **Confirm-guarded.** |
| `join_chat` | MTProto | **write** | Join a public chat by @username or a private one by invite link. Rate-capped. |
| `leave_chat` | MTProto | **write** | Leave a channel/supergroup or basic group. |
| `get_bot_info` | Bot API | read | The bot's own info (getMe) + capability flags. |
| `send_bot_message` | Bot API | **write** | Send a text message as the bot. **Confirm-guarded.** |
| `send_document` | Bot API | **write** | Send a file (URL, file_id, or local upload). **Confirm-guarded.** |
| `send_poll` | Bot API | **write** | Send a poll (2-10 options). **Confirm-guarded.** |
| `send_inline_keyboard` | Bot API | **write** | Send a message with tappable inline buttons. **Confirm-guarded.** |
| `handle_callback` | Bot API | read | Long-poll for inline-button taps and return the callback data. |
| `send_bot_media` | Bot API | **write** | Send photo/video/audio/voice/animation as the bot. **Confirm-guarded.** |
| `send_media_group` | Bot API | **write** | Send an album (2–10 items). **Confirm-guarded.** |
| `edit_bot_message` | Bot API | **write** | Edit the bot's message text/caption. |
| `delete_bot_message` | Bot API | **write** | Delete messages the bot can delete (destructive). |
| `forward_message` | Bot API | **write** | Forward message(s) between chats. **Confirm-guarded.** |
| `copy_message` | Bot API | **write** | Copy a message (no "forwarded from"). **Confirm-guarded.** |
| `send_chat_action` | Bot API | **write** | Show a "typing…"/"uploading…" status. |
| `get_file` | Bot API | read | Download a file the bot received (by file_id) to disk. |
| `get_chat_info` | Bot API | read | Chat title/type/description + member count. |

### Confirm-before-send safety pattern

Every message-*sending* tool (`send_message`, `send_media`, `send_scheduled`,
`reply_to_topic`, and the bot `send_*` / `forward_message` / `copy_message` tools)
**plus the destructive `delete_message`, `delete_bot_message`, and `leave_chat`** are
**two-step** so an agent cannot send, delete, or leave by accident:

1. **First call** (omit `confirmToken`) → validates input, resolves the target, and
   returns a **preview** with a single-use `confirmToken`. **Nothing happens.**
2. **Second call** (same arguments **plus** `confirmToken`) → the token is verified
   against the exact target+content, consumed, and only then is the action performed.

The token is server-minted, unguessable, single-use, expires after 5 minutes, and is
bound to the precise content — so there is no single-call path to a send or delete, and a
token minted for one action can't be reused for a different one.

> Other writes (`edit_message`, `edit_bot_message`, `mark_as_read`) are not gated —
> they're reversible. `join_chat` is rate-limited rather than confirm-gated.

---

## Permissions & approvals

There are **two independent safety layers** — know which is which:

1. **Your MCP client's approval** ("allow this tool call?") — the real *human-in-the-loop*.
   This is controlled entirely by **your client**, not by this server. The server can't
   (and shouldn't) approve itself past it.
2. **This server's confirm gate** (preview → `confirmToken`) — an in-tool guard that stops
   an *accidental single-call* send/delete. Always on for sends + destructive actions.

**Every tool carries MCP annotations** (`readOnlyHint`, `destructiveHint`, `openWorldHint`)
so your client can prompt intelligently — auto-allow the safe reads, prompt for the risky
writes.

### Reducing approval prompts (optional, per client)
- **Claude Desktop / Cursor** — approve on first use and pick **"always allow"** for the
  tools you trust.
- **Claude Code** — add to `permissions.allow` in `.claude/settings.local.json`, e.g.
  `"mcp__telegram"` (all tools) or specific ones like `"mcp__telegram__get_me"`.

### Recommended posture
- **Reads** (`get_*`, `search_*`, `download_media`) are safe to auto-allow.
- **Writes** — for a *hard* human gate, keep your client's prompt **on** for them; otherwise
  the confirm gate still prevents accidental one-call sends (note: an autonomous agent can
  satisfy the confirm gate itself by calling twice, so it's an accident-guard, not a human
  gate — pair it with client approval if you need a true checkpoint).

---

## Usage examples

You invoke tools by asking your MCP client (Claude, Cursor, …) in plain English — it
picks the right tool and arguments. The prompts below are representative; adapt the
placeholders:

- `<chat>` — `"me"` (Saved Messages), an `@username`, or a numeric chat id. For numeric
  ids, run `get_dialogs` first so the session knows the chat.
- `<id>` — a message id (returned by send/read tools). `<chat-id>` / `<user-id>` — numeric ids.
- **Sends preview first** — you'll get a preview + `confirmToken`; reply *"confirm and send"* to actually send.

> ⚠️ When experimenting with **write** tools on a personal account, keep them in
> **Saved Messages** (`"me"`) and read [ACCOUNT-SAFETY.md](./ACCOUNT-SAFETY.md) first.

### MTProto — reads (safe)

| Tool | Example prompt | Result |
| --- | --- | --- |
| `get_me` | *"Which Telegram account am I using?"* | your id, name, username |
| `get_dialogs` | *"List my 20 most recent chats with their IDs."* | chats with ids, types, unread counts |
| `get_messages` | *"Read the last 10 messages from `<chat>`."* (or *"…from `<chat>` since 2026-06-01."*) | messages with sender, text, reactions, poll counts |
| `search_messages` | *"Search `<chat>` for 'invoice'."* / *"Search all my chats for 'invoice'."* | matching messages |
| `get_unread_summary` | *"Summarize my unread messages — 5 chats, 3 each."* | compact digest grouped by chat |
| `get_topic_messages` | *"Read topic `<topicId>` in `<forum-group>`."* | messages from that forum topic |
| `download_media` | *"Download the media from message `<id>` in `<chat>`."* | saved file path + size |

### MTProto — writes (preview → confirm)

| Tool | Example prompt | Result |
| --- | --- | --- |
| `send_message` | *"Send 'hello' to `<chat>`."* → *"confirm and send"* | preview, then `status: sent` + message id |
| `send_media` | *"Send the photo at `<path-or-url>` to `<chat>`."* → confirm | media posted |
| `send_scheduled` | *"Schedule 'reminder' to `<chat>` for 2026-06-10T09:00:00Z."* → confirm | `status: scheduled` |
| `reply_to_topic` | *"Post 'hi' to topic `<topicId>` in `<forum-group>`."* → confirm | posted in the topic |
| `edit_message` | *"Edit message `<id>` in `<chat>` to 'updated'."* | message text changes |
| `mark_as_read` | *"Mark `<chat>` as read."* | unread badge clears |
| `join_chat` | *"Join `@channelname`."* (or an invite link) | `status: joined` (rate-limited) |
| `leave_chat` | *"Leave `<chat>`."* → confirm | preview, then `status: left` |
| `delete_message` | *"Delete message `<id>` from `<chat>`."* → confirm | **destructive** — preview, then removed |

### Bot API (needs `TELEGRAM_BOT_TOKEN`)

Target a user who has tapped **Start** on your bot (use their `<user-id>`) or a group the
bot is in.

| Tool | Example prompt | Result |
| --- | --- | --- |
| `get_bot_info` | *"Show the bot's info."* | bot id, username, flags |
| `get_chat_info` | *"Get chat info for `<chat-id>`."* | title, type, member count |
| `get_file` | *"Download bot file with file_id `<id>`."* | saved path + size |
| `send_bot_message` | *"Send 'hi from bot' to `<user-id>`."* → confirm | message sent |
| `send_bot_media` | *"Send the photo `<url>` as the bot to `<user-id>`, type photo."* → confirm | inline photo |
| `send_document` | *"Send the file `<url>` as the bot to `<user-id>`."* → confirm | document message |
| `send_media_group` | *"Send an album to `<user-id>`: `<url1>`, `<url2>`."* → confirm | 2-item album |
| `send_poll` | *"Send a poll to `<user-id>`: 'Lunch?' options Pizza, Sushi."* → confirm | a poll |
| `send_inline_keyboard` | *"Send buttons to `<user-id>`: 'Pick one', A→a and B→b."* → confirm | message with buttons |
| `handle_callback` | *(after sending buttons and tapping)* *"Listen for button taps for 30 seconds."* | the tapped `callbackData` |
| `send_chat_action` | *"Show a typing action in `<user-id>`."* | "typing…" appears briefly |
| `forward_message` | *"Forward message `<id>` from `<src>` to `<user-id>`."* → confirm | forwarded (with header) |
| `copy_message` | *"Copy message `<id>` from `<src>` to `<user-id>`."* → confirm | copied (no header) |
| `edit_bot_message` | *"Edit bot message `<id>` in `<user-id>` to 'new text'."* | bot's message changes |
| `delete_bot_message` | *"Delete bot message `<id>` in `<user-id>`."* → confirm | preview, then removed |

---

## Development

```bash
npm run typecheck   # tsc --noEmit (strict)
npm run build       # tsup -> dist/
npm run dev         # tsup --watch
```

### Project layout

```
src/
  index.ts          # registers enabled tools, starts the stdio server
  client/           # gramjs (MTProto) client wrapper
  tools/            # one file per tool + the registration interface
  lib/              # config/mode detection, zod-based errors, rate limiter
  auth/             # login / logout / clear-session CLI
```

### Engineering rules

1. Every tool input is validated with `zod` before any Telegram call.
2. No raw errors reach the client — failures return structured, human-readable text.
3. Reads are safe; writes (and destructive actions) are guarded by a confirm-before-send preview.
4. One tool per file, registered through a single interface.
5. Per-chat and per-user rate limiting to stay clear of spam detection.
6. MTProto and Bot API modes are isolated.

---

## License

MIT
