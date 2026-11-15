# dsh-favicon-status

Shows [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Session status on the browser tab, so you can tell what your agents are doing from any other tab or window.

- **Favicon badge**: a coloured dot on the tab icon, or a spinning ring while Sessions run.
- **Title prefix**: a short status in front of the page title, such as `⚠ 2 Waiting · `.

It replaces [`@climber47/dsh-tab-status`](https://github.com/WsTe47/dsh-tab-status), which crashes on DSH 0.2.x, and adds a red "broken" state.

## States

| Favicon | Title prefix | When |
|---|---|---|
| 🔴 Red dot | `✕ 1 Failed · ` | A Session's latest turn broke (an error, DSH exiting mid-turn, or a sign-out) and you have not opened it since. Stopping a turn yourself does not count. |
| 🟡 Yellow dot | `⚠ 2 Waiting · ` | A Session waits on you: an approval, a question, or a plan review. |
| 🟢 Green dot | `✓ 3 Done · ` | A Session finished successfully while you were viewing another one. |
| 🔵 Spinning ring | `● Running · ` (`● 3 Running · ` for several) | A Session or one of its subagents is running, and nothing above applies. |
| Original icon | none | Nothing to report. |

- **Priority:** red > yellow > green > running > idle. The most urgent state wins.
- **Counts:** the title always shows how many Sessions are in the winning state. The favicon dot shows a number only when there are several (up to `9+`).
- **Clearing:** open the Session. Red, yellow and green all clear the same way the sidebar dots do.
- **Subagents:** subagent Sessions are not counted on their own; their parent carries the status.

The DSH title (`<session> — DeepSeek Harness`) is kept; the prefix is layered in front of it.

## Requirements

- DeepSeek Harness **0.2.2-rc.3 or later**, Web UI.
- A browser that shows favicons in the tab bar. Some browsers hide favicons for pinned or grouped tabs.

## Install

From the DSH Web UI: **Plugins** → **Add plugin**, then enter the package source.

From the command line:

```sh
dsh plugin --profile <your-profile> add <package-source>
```

The plugin has a server-side part, so restart `dsh web` if the Plugins page says a restart is required. Then refresh the browser tab.

If `@climber47/dsh-tab-status` is installed, turn it off first: both plugins rewrite the favicon and the title.

## Language

Title words follow the DSH language setting: English, Vietnamese, and Simplified Chinese. Other languages fall back to English.

| State | English | Tiếng Việt | 简体中文 |
|---|---|---|---|
| Red | Failed | Lỗi | 出错 |
| Yellow | Waiting | Chờ bạn | 待处理 |
| Green | Done | Xong | 已完成 |
| Running | Running | Đang chạy | 进行中 |

## Colours

Badge colours come from the active DSH theme's state tokens and redraw when the theme or the system light/dark mode changes:

| State | Theme token | Fallback |
|---|---|---|
| Red | `--dsw-alias-state-error-primary` | `#e5484d` |
| Yellow | `--dsw-alias-state-warn-primary` | `#f5b301` |
| Green | `--dsw-alias-state-success-primary` | `#30a46c` |
| Running | `--dsw-alias-brand-primary` | `#3e8cf0` |

## How it works

- **Server** ([`index.js`](index.js)) registers a `faviconTurnOutcome` Session projection. Its value is `{ seq, code }` when the latest turn ended in a failure, and `null` otherwise. DSH sends it to the browser over the existing Session control stream, so nothing polls.
- **Browser** ([`client.js`](client.js)) reads the same session list and session status the sidebar uses, picks the state, and:
  - replaces the favicon `<link>` with a canvas-drawn PNG, putting the original links back when idle;
  - adds the title prefix and re-applies it, via a `MutationObserver`, whenever something else rewrites the title.
- **Red acknowledgement** is stored per browser in `localStorage` under `dsh-favicon-status.ack.v1`. The first time the plugin runs, failures that already exist count as seen, so the tab does not start out red.

## Troubleshooting

- **No change at all:** hard-refresh the tab (Ctrl+Shift+R / Cmd+Shift+R). In **Plugins**, check that the `favicon-status` row is on. Then look in the browser console for `dsh-favicon-status` or `slot entry crashed` errors.
- **The red dot never clears:** open the broken Session in the main view. To reset everything, run `localStorage.removeItem('dsh-favicon-status.ack.v1')` in the console and refresh.
- **The favicon flickers between two icons:** another plugin also rewrites the favicon. Turn it off.

## Develop

```sh
npm run check   # syntax check both halves
npm test        # projection fold and state derivation (Node test runner)
```

There is no build step: `index.js` and `client.js` are the files DSH loads. To try local changes, install the checkout directory from **Plugins** → **Add plugin**. A linked install picks up `client.js` edits after a page refresh; `index.js` edits need a `dsh web` restart.

## License

MIT
