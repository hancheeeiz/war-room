# War room

A commander for solo builders who run several AI coding chats at once. One chat becomes the **commander**. It:

- **Keeps the long-term memory.** It records your rules, decisions, preferences and facts with dates, and asks you when something new conflicts with an older decision. It refuses questions that memory already answers, and it never stores secrets.
- **Judges every new goal before planning it.** It asks the intake questions, checks fit, cost, risk and conflicts, and proposes a stronger version. You choose keep / improved / later / drop.
- **Plans.** It turns the goal into milestones with checks and sets a few goals for each day. Progress bars count only checks the commander has verified itself.
- **Hands out work to parallel chats.** Each chat gets a task packet with only its files, its done check and the rules that apply, and one writer per file is enforced.
- **Connects other agents.** Codex, Cursor, Gemini CLI or any agent that speaks MCP can join through the same connector.
- **Asks for your yes before risky actions.** A guard hook asks first before git push, deploys, publishing, app store uploads, deleting data, money, keys and installing new skills.

No goal, no war room: the session hook stays silent in projects that have no `.warroom/` folder.

## Use it in Claude Code

```bash
claude --plugin-dir /path/to/war-room
```

Then, in the chat that should be the commander:

```
/war-room I want to launch a habit app on iOS before December
```

The commander creates `.warroom/` in the project, asks what is missing, judges and improves the idea, waits for your choice, then plans it and creates tasks.

To start a worker chat in Claude Code, give it a name so the session hook briefs it:

```bash
WAR_ROOM_AGENT=frontend claude --plugin-dir /path/to/war-room
```

The worker calls `get_task_packet`, does only that, and finishes with `report_done` plus its evidence.

## Connect other agents

Every agent runs the same server: `node /path/to/war-room/server/index.mjs`. Set `WAR_ROOM_DIR` to the project folder.

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.war-room]
command = "node"
args = ["/path/to/war-room/server/index.mjs"]
env = { WAR_ROOM_DIR = "/path/to/project" }
```

Cursor (`.cursor/mcp.json`) and Gemini CLI (`.gemini/settings.json`):

```json
{ "mcpServers": { "war-room": { "command": "node", "args": ["/path/to/war-room/server/index.mjs"], "env": { "WAR_ROOM_DIR": "/path/to/project" } } } }
```

Tell that agent its name ("you are `codex` in the war room; call war_room_brief"). The guard hook is Claude Code only. In other agents, keep their own approval settings on for push, deploy and delete.

## The page

```bash
node /path/to/war-room/bin/war-room.mjs serve        # http://127.0.0.1:4818, this computer only
node /path/to/war-room/bin/war-room.mjs dashboard    # or write a static .warroom/dashboard.html
```

**Main** tab: the main goal's progress bar and deadline, today's goals, the milestone bars, the questions waiting on you (answer in place, with the suggested answer one tap away), a box to tell the war room any new thought, and the 5 most recent events. **Details** tab: every chat and what it is doing, every goal with its checks, all tasks, the memory by kind, open messages and the full log, each list folded after 10 rows.

Under `serve`, answers and thoughts save straight into the war room and the page refreshes itself when anything changes. The static file shows a copy-and-run command instead.

## Approve from your phone

Run the page in phone mode and open the printed link on your phone (same Wi-Fi):

```bash
node /path/to/war-room/bin/war-room.mjs serve --lan
```

The link carries a secret token; without it the page refuses everything. Keep the link private.

The **Approve** card at the top of Main shows two kinds of request, each with buttons:

- **Actions an agent asked to do**, such as a deploy, push, publish, payment, deletion or key use. Agents raise them with `request_approval`, or the guard raises them by itself.
- **Judged goals waiting for your choice**: Keep / Improved / Later / Drop.

Agents can ask (`request_approval`) and check (`check_approval`), but no tool lets an agent approve. Only your page or your terminal can: `war-room approve --id a1 --yes`.

**Letting the guard act on phone approvals is opt-in.** Set `"remoteApprovals": true` in `.warroom/config.json`. With it on, the guard handles a risky command this way:

1. Instead of waiting at a terminal prompt nobody is watching, it blocks the command and files an approval request.
2. Once you approve it, that **exact** command may run **once**, within 30 minutes.
3. A changed command needs a new approval.

With it off, which is the default, the guard asks at the terminal as before.

## The watcher: one alarm, no polling

The war room is event-driven — a finished task drops its report into the commander's inbox by itself, so nobody checks chats on a timer. The one exception is a chat that dies without reporting. For that, run the watcher:

```bash
node /path/to/war-room/bin/war-room.mjs watch --every 60
```

Hourly (default) it posts a deduped alert to the commander's inbox for any task claimed too long with no report (`staleHours` in `.warroom/config.json`). It also reacts **instantly** to war-room file changes — no 6-minute reply polling: set `notifyCommand` in `.warroom/config.json` to any shell command (a push script, `osascript` notification, …) and it runs with the message as its argument the moment something changes.

The founder can answer a queued question instantly from any terminal or phone bridge:

```bash
node /path/to/war-room/bin/war-room.mjs answer --question m7 --text "violet, always"
```

It is recorded as a decision at once and the question closes.

## Tools

| Tool | Who | What |
|---|---|---|
| `war_room_brief` | everyone | Rules, your task, your messages (short) |
| `war_room_status` | everyone | Progress bars, today's goals, each agent's task, last 10 events |
| `remember` / `recall` | everyone | Long-term memory with conflict check |
| `ask_founder` / `founder_answer` | anyone / commander | Questions that memory cannot answer |
| `propose_goal` → `judge_goal` → `decide_goal` → `set_plan` → `set_today` | commander | Goal intake, judging, founder choice, plan |
| `create_task` / `verify_task` | commander | Hand out and check work |
| `get_task_packet` / `report_done` | workers | Do one packet, report evidence |
| `post_message` / `read_messages` | everyone | Requests, contracts, handoffs between agents |

Agent names are self-declared. The commander-only checks keep roles clear between cooperating chats; they are not a security boundary.

## Data

Plain JSON in `<project>/.warroom/`: `memory.json`, `goals.json`, `tasks.json`, `messages.json`, `log.jsonl`. A file lock keeps several agents from overwriting each other. It has no dependencies; needs Node 18+.

## Tests

```bash
npm test
```
