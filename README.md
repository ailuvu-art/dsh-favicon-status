# dsh-favicon-status

A DeepSeek Harness bundle that mirrors Session status onto the browser tab: a favicon badge and a page-title prefix. It replaces `@climber47/dsh-tab-status`, which no longer works on DSH 0.2.x.

| Badge | When |
|---|---|
| 🔴 Red | A Session's latest turn broke (error, process exit mid-turn, sign-out) and you have not opened it since |
| 🟡 Yellow | A Session waits on you: approval, question, or plan review |
| 🟢 Green | A Session finished successfully while you were viewing another one |
| 🔵 Spinner | Sessions or their subagents are running and nothing above applies |
| — | Original favicon |

## Title prefix

The built-in title (`<session> — DeepSeek Harness`) is kept; a prefix is layered on top and re-applied after any other write via a `MutationObserver`:

```
✕ 1 Failed · My session — DeepSeek Harness
⚠ 2 Waiting · My session — DeepSeek Harness
✓ 3 Done · My session — DeepSeek Harness
● Running · My session — DeepSeek Harness   (● 3 Running · for several)
```

Words follow the UI language (English, Vietnamese, Simplified Chinese; others fall back to English). Badge colours come from the theme's state tokens and repaint on theme or light/dark changes.

Priority: red > yellow > green > spinner > idle. With several Sessions in the winning state the dot shows a count (up to `9+`). Subagent Sessions are ignored; their parent carries the status.

## How it works

- **Host** (`index.js`) registers a `faviconTurnOutcome` Session projection: `{ seq, code }` for a failed latest `turn/end`, else `null`. It reaches the browser through the Session control stream; no polling.
- **Client** (`client.js`) reads `ctx.sessions.list` and `ctx.uiSession.sessionStatus` (the same sources the sidebar dots use), derives the state, and swaps the favicon `<link>` for a canvas-drawn PNG. Idle restores the original links.
- Red acknowledgement is per browser (`localStorage` key `dsh-favicon-status.ack.v1`): opening the broken Session clears it. On first run, breaks that already exist count as seen.

## Install

**Plugins** → **Add plugin** → choose this directory, or with the profile CLI install it as a local link.

Disable `@climber47/dsh-tab-status` first: it also rewrites the favicon and title (and crashes on DSH 0.2.x).

## Develop

```sh
npm run check   # syntax
npm test        # projection fold + state derivation
```
