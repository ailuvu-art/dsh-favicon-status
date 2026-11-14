# dsh-favicon-status

A DeepSeek Harness bundle that colors the browser tab favicon by Session status.

| Badge | When |
|---|---|
| 🔴 Red | A Session's latest turn broke (error, process exit mid-turn, sign-out) and you have not opened it since |
| 🟡 Yellow | A Session waits on you: approval, question, or plan review |
| 🟢 Green | A Session finished successfully while you were viewing another one |
| 🔵 Spinner | Sessions are running and nothing above applies |
| — | Original favicon |

Priority: red > yellow > green > spinner > idle. With several Sessions in the winning state the dot shows a count (up to `9+`). Subagent Sessions are ignored; their parent carries the status.

## How it works

- **Host** (`index.js`) registers a `faviconTurnOutcome` Session projection: `{ seq, code }` for a failed latest `turn/end`, else `null`. It reaches the browser through the Session control stream; no polling.
- **Client** (`client.js`) reads `ctx.sessions.list` and `ctx.uiSession.sessionStatus` (the same sources the sidebar dots use), derives the state, and swaps the favicon `<link>` for a canvas-drawn PNG. Idle restores the original links.
- Red acknowledgement is per browser (`localStorage` key `dsh-favicon-status.ack.v1`): opening the broken Session clears it. On first run, breaks that already exist count as seen.

## Install

**Plugins** → **Add plugin** → choose this directory, or with the profile CLI install it as a local link.

Conflicts with `@climber47/dsh-tab-status`, which also rewrites the favicon; disable its favicon or the plugin when using this one.

## Develop

```sh
npm run check   # syntax
npm test        # projection fold + state derivation
```
