# Account Safety

Using a **personal Telegram account** through automation (MTProto) carries a real
risk of getting **rate-limited or banned** if it behaves like spam. This is the #1
problem reported across Telegram MCP projects ("Telegram killed my account after
login"). `telegram-mcp-ts` is built to minimize that risk. This document explains
what's dangerous and what the server does about it.

> Bot API mode (a bot token) does **not** carry this risk — bots are sandboxed.
> The guidance here is about **MTProto / user-account** mode.

---

## What gets a user account banned or limited

1. **Unsolicited messages to strangers** (people not in your contacts who never
   messaged you) — the classic spam signal.
2. **Bursts / high volume** — many sends, edits, or deletes in a short window.
3. **Rapid joining** of many channels/groups in a short time.
4. **Ignoring FLOOD_WAIT** — Telegram tells you to slow down; hammering anyway
   escalates to harder limits.
5. **Repeated fresh logins** instead of reusing a session.

---

## What this server does to protect you

| Risk | Mitigation |
| --- | --- |
| Bursts / high volume | **Rate limiter** with per-chat + global minimum gaps and random jitter (so traffic isn't metronome-regular). |
| Ignoring backpressure | **Honors FLOOD_WAIT** automatically (gramjs `floodSleepThreshold`) and Bot API `429 retry_after` exactly, then **adaptively widens** its gaps for a cool-down window. |
| Accidental sends | **Confirm-before-send**: every send tool previews first and requires a second confirmed call with a single-use token. No one-call sends. |
| Cold outreach | `send_message` **flags a cold-contact warning** in the preview when the recipient isn't in your contacts. |
| Repeated logins | Session string is **persisted and reused**; the server connects once. |
| Hammering a failing endpoint | **Circuit breaker** stops calls after repeated failures (looks abusive otherwise). |
| Crashes mid-operation | **Auto-reconnect** + retry-with-backoff; the process doesn't die on a dropped connection. |

### Safe mode (default ON)

Controlled by `TELEGRAM_SAFE_MODE` (default `true`). In safe mode the rate limits
are deliberately conservative. You can loosen them with `TELEGRAM_SAFE_MODE=false`
**at your own risk** — only do this if you understand the trade-off.

### Not supported, on purpose

**Bulk / mass / broadcast sending is intentionally not implemented.** It is the
fastest route to a ban and the opposite of this tool's purpose. Sends are
one-at-a-time and confirm-gated.

---

## Best practices for you

- **Use a throwaway account** for development and aggressive testing — never your
  primary account.
- Confine write-tool testing to **Saved Messages** (`chat: "me"`).
- Don't disable safe mode unless you have a specific, low-volume reason.
- Don't script tight loops of sends/joins, even with this server's throttling.
- Run `telegram-mcp-ts doctor` to confirm your session is valid before a session of work.

---

## Diagnostics

```bash
npx telegram-mcp-ts doctor   # or: node dist/index.js doctor
```

Checks Node version, which modes are configured, session validity + connectivity
(MTProto), bot token validity (Bot API), and whether safe mode is on.
