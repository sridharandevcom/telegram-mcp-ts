# Getting Started with telegram-mcp-ts

A beginner-friendly guide to install **telegram-mcp-ts** and connect it to Claude
(or any MCP client) so an AI assistant can read and act on Telegram for you.

No prior experience with MCP needed — just follow the steps in order.

---

## 1. What is this?

It's a small program (an **MCP server**) that gives an AI assistant a set of
**Telegram tools** — like "list my chats", "send a message", "summarize my
unreads". You talk to the assistant in plain English, and it uses these tools.

It works in **two modes** (pick one or both):

| Mode | Acts as… | Good for |
| --- | --- | --- |
| **Personal account (MTProto)** | **you** | reading your chats, summarizing unreads, sending as yourself |
| **Bot (Bot API)** | a **bot** you create | automated messages, polls, buttons, files |

> ⚠️ **Safety first:** the personal-account mode logs in as *you*. For trying
> things out, use a **spare/throwaway Telegram account**, and keep test messages
> in your **Saved Messages**. See the safety notes at the end.

---

## 2. What you need

- **Node.js 18.18 or newer** (Node 20 recommended). Check with:
  ```bash
  node --version
  ```
  If it's older or missing, install it from [nodejs.org](https://nodejs.org).
- An **MCP client** — e.g. **Claude Desktop**, **Claude Code**, or **Cursor**.
- **Credentials** for the mode(s) you want (next step).

You do **not** need to install the package manually — your client runs it on
demand with `npx`.

---

## 3. Get your credentials

### Option A — Personal account (MTProto)

1. Go to **<https://my.telegram.org>** → **API development tools**.
2. Create an app (any name) and copy your **`api_id`** and **`api_hash`**.
3. Generate a reusable **session string** by logging in once. In a terminal:
   ```bash
   npx telegram-mcp-ts-auth login
   ```
   It will ask for:
   - your **API ID** and **API HASH** (from step 2),
   - your **phone number** (e.g. `+15551234567`),
   - the **login code** Telegram sends you,
   - your **2FA password** (only if your account has one).

   When it finishes, it prints a long **session string**. Copy it somewhere safe.

   > 🔑 Treat the session string like a password — it grants full access to that
   > account. Don't share it or commit it to git.

### Option B — Bot (Bot API)

1. Open **[@BotFather](https://t.me/BotFather)** in Telegram → send `/newbot`.
2. Follow the prompts and copy the **bot token** it gives you.
3. Open your new bot and tap **Start** (so it's allowed to message you).

You can set up **both** modes if you want all features.

---

## 4. Connect it to your MCP client

You tell your client how to start the server by adding a small JSON block. Use
only the environment variables for the mode(s) you set up.

### Claude Desktop

Edit `claude_desktop_config.json`:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "telegram": {
      "command": "npx",
      "args": ["-y", "telegram-mcp-ts"],
      "env": {
        "TELEGRAM_API_ID": "1234567",
        "TELEGRAM_API_HASH": "your_api_hash",
        "TELEGRAM_SESSION": "your_session_string",
        "TELEGRAM_BOT_TOKEN": "123456:your_bot_token"
      }
    }
  }
}
```

### Claude Code / Cursor

Create a file named **`.mcp.json`** in your project folder with the **same**
`mcpServers` block as above.

> Include only the vars for the mode(s) you want:
> - **Personal account:** `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION`
> - **Bot:** `TELEGRAM_BOT_TOKEN`

---

## 5. Restart and verify

1. **Fully restart** your MCP client (it reads the config on startup).
2. In a new chat, ask:
   > *"Use the telegram get_me tool — which account am I using?"*

   If it returns your account info, you're connected. ✅

3. Try a safe read:
   > *"Give me an unread summary of my Telegram — 5 chats."*

### Check your setup any time
```bash
npx telegram-mcp-ts doctor
```
This verifies your Node version, credentials, session validity, and bot token,
and tells you how to fix anything that's wrong.

---

## 6. Doing things safely

Sending and deleting are **two-step on purpose**, so nothing happens by accident:

1. You ask to send/delete → the tool returns a **preview** and does nothing.
2. You confirm → it actually happens.

So a typical send looks like:
> *"Send 'hello' to my Saved Messages."* → (preview appears) → *"confirm and send."*

Other safety built in:
- **Rate limiting** so you don't trip Telegram's spam detection.
- **Safe mode is on by default** (conservative speed). Keep it on.
- **Cold-contact warnings** before messaging someone not in your contacts.

**Golden rules while learning:** use a throwaway account, keep writes in **Saved
Messages**, and don't script rapid sends.

---

## 7. Optional settings

Add these to the `env` block if you need them:

| Variable | Default | What it does |
| --- | --- | --- |
| `TELEGRAM_SAFE_MODE` | `true` | Conservative rate limits. Set `false` only if you understand the ban risk. |
| `TELEGRAM_META_MODE` | `false` | Shows just two tools (`list_tools` + `call_tool`) to save the AI's context when many tools are enabled. |
| `TELEGRAM_TRANSPORT` | `stdio` | Set to `http` to serve over HTTP (`TELEGRAM_HTTP_PORT`, `TELEGRAM_HTTP_HOST`) instead of stdio. |

---

## 8. Troubleshooting

| Problem | Fix |
| --- | --- |
| `node`/`npx` errors or very old version | Install Node 18.18+ (Node 20). Run `node --version` to check. |
| Server shows as "failed" in the client | Re-check the `env` values and restart the client. Run `npx telegram-mcp-ts doctor`. |
| "could not resolve chat" for a numeric ID | Ask it to *list your dialogs* first so the session learns that chat. |
| Bot says "can't initiate conversation" | Open your bot in Telegram and tap **Start** first. |
| Login can't connect to Telegram | Your network may block Telegram — try a VPN. |
| Nothing sends | Remember the **two-step confirm** — you must confirm after the preview. |

---

## 9. Managing your login

```bash
npx telegram-mcp-ts-auth login          # log in, get a session string
npx telegram-mcp-ts-auth logout         # revoke the session on Telegram's servers
npx telegram-mcp-ts-auth clear-session  # how to forget the session locally
```

Use **logout** if your session string ever leaks or you're done with an account.

---

That's it. Once connected, just ask your assistant in plain English — for example
*"summarize my unread Telegram messages"* or *"send a reminder to my Saved
Messages."* Enjoy! 🎉
