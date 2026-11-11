# War room

You talk to one commander, like the boss of a small AI company. You say what you want in plain words; it remembers everything you decide, plans the work, hires a team of named roles (designer, backend, reviewer…) and hands each job to the right one, has AI agents from different companies argue about hard choices, shows progress on one page, and asks for your yes before anything risky.

## Start in 3 steps

1. In Claude Code, install it (once):
   ```
   /plugin install war-room --marketplace hancheeeiz/war-room
   ```
2. Open your project and type your goal:
   ```
   /war-room:war-room I want to launch a habit app on iOS before December
   ```
   (Typing `/war-room` and picking it from the list, or just saying "connect war room" in a chat, does the same.)
3. Open the page link the commander gives you. That's it: type anything into the one box there (the commander picks it up in the background), answer its questions in the same box, and tap Approve for risky steps — from your computer or your phone.

Everything else (starting helper chats, the page, connecting other agents) the commander does for you, and it asks first when something changes your computer's settings.

## What it does

- **Remembers.** Every preference, decision, idea and to-do you mention is stored with its date. It reminds you of past decisions and never asks what it already knows. It never stores passwords, keys or card numbers.
- **Judges before it plans.** A new idea gets checked for fit, cost, risk and clashes with earlier decisions, and you get a stronger version to choose from: keep / improved / later / drop. It also decides whether the goal needs you to learn anything first.
- **Plans with honest progress and dates.** As many milestones as the goal really needs (one for a small job, more for a big one; no set number), each with checks and a due date (a plan without dates is refused). A milestone past its date turns red as **Behind**. Bars move only when the commander has re-checked the work itself.
- **Today's list makes itself.** Each new day the war room builds today's list from the plan: yesterday's unfinished items carry over, then the next open checks fill it up to three. The commander can improve it and give items a time (`"at": "09:30"`). Once a day the watcher leaves one plain summary in the commander's inbox and on your phone notifier: today, behind schedule, questions waiting on you, work nobody is running. `war-room daily` does it now.
- **The commander routes, the team works.** The commander cannot take tasks or have them handed back to it, so it never checks its own work. A task for a hired role starts that role's chat straight away (`"autoStartWorkers": false` turns this off). Each chat keeps one name: a chat that acted as the commander cannot report as "mobile", a task must be taken before it is reported, and a chat running task tools from the shell needs your yes. The brief calls out open work with nobody on it.
- **Keeps going when no chat is open (the engine), on Mac and Windows.** Run `war-room engine install` once, in each project that has a war room (add `--project <folder>` for others). Your Mac then keeps each war room's page and watcher running from login. Every 10 minutes the watcher hands fresh untaken work to the team (at most 3 workers at once, 3 restarts per task a day; work untouched for over 3 days waits for the commander instead). Every morning after 08:00 it wakes the commander when something needs it: reports to check, messages, plans without dates, old open work. Checked reports close their own inbox messages. On Windows it puts a small hidden-window script in your Startup folder (no admin rights needed). `war-room engine status` shows what runs; `war-room engine uninstall` turns it off. The first time, macOS may ask whether node may open your Documents folder: allow it, or the engine cannot read war rooms kept there.
- **Work goes to the team only.** Tasks can be given only to hired roles (`"teamOnly": false` allows any name). A chat working under another name is told it is not on the team, and the commander's brief lists it.
- **Grows the features you want (add-ons).** Each founder wants different things: a lesson page, a reading tracker, a habit log. When the commander builds one in your project it registers it with `add_feature`. You approve it once on the page under **Your tools** (nothing it lists runs before that, and a changed command needs approving again). Then the page links to it and shows what is waiting in it, `war-room up` starts it, and the commander's brief and daily check list what waits there, so a question you left in a lesson does not go unanswered. `war-room addon` lists them in the terminal.
- **Remembers you between chats.** Every commander chat starts with your latest decisions and preferences listed, not just the rules, so it does not ask again.
- **Runs a team.** The commander hires a few named roles for your goal and the page draws them as a chart: you → commander → each member, with what each is doing right now. Tap a member to talk to it directly. Members can come from different companies (a Gemini reviewer checking Claude's work catches more).
- **Works step by step when it must.** A job can wait for another ("review after build"); the next member starts by itself once the step before is checked.
- **Starts helper chats itself.** Each helper gets only its task, its files and the rules that apply, works in the background, and reports back. One writer per file. If a helper stops at something that needs your yes, it starts again by itself once you approve.
- **Lets different AI companies argue.** For a hard question it puts the same question to Claude, Codex, Gemini or Cursor (whichever you have). Each answers blind, then reads the others and argues; it may change its mind only by naming the argument that changed it. You see every answer side by side. Agents from one company share blind spots, so the page says so when only one company took part.
- **Keeps a shelf of documents to reread.** Notes, laws and decision write-ups too long for one memory sentence go on a shelf on the page, shown as a readable page straight from the project file.
- **Asks before anything risky.** Pushing code, deploying, publishing, deleting data, spending money, using keys, sending messages for you: each needs your yes for that exact action, once.
- **Starts with good rules.** Nine built-in rules (below), and you can add your own.

## Useful commands (optional)

The commander runs these for you; they are here if you like a terminal.

```bash
war-room doctor            # what is installed, connected and running, with the next step for each gap
war-room up --phone        # the page plus a private link for your phone (same Wi-Fi)
war-room status            # progress bars in the terminal
war-room engine install    # keep this war room running from login (status · add · remove · uninstall)
war-room morning           # wake the commander now to work through what needs it
war-room daily             # make today's list and send the daily summary now
war-room addon             # your add-ons: what they run and what waits (--name N --approve to approve one)
war-room debate "Should we use Postgres or SQLite?"   # let the installed agents argue
war-room connect codex     # join Codex (or gemini, cursor) to the war room; shows the change, then --yes
war-room spawn frontend    # start a helper chat by hand
```

(`war-room` is `node <plugin folder>/bin/war-room.mjs`; inside Claude Code the commander knows the path.)

## Starter rules

Every war room starts with nine built-in rules that every chat sees in its briefing:

```bash
war-room rules              # list them, plus your own
war-room rules --off s6 --yes  # switch one off on this computer
war-room rules --on s6 --yes
```

They live in the plugin's code, so a downloaded project cannot change or remove them, and the on/off choice is kept in `~/.config/war-room/config.json`. **Add your own rules any time:** say "new rule: …" to the commander. Your own rules come from the commander (`remember`, kind `rule` or `never`) and take effect once you approve them on the page.

## Your apps work as one team (Codex app, Claude app, any agent)

You can run the team in the apps you already use, on Mac or Windows: the Codex app, the Claude app, Claude Code, Cursor. No copying text between them.

1. **Connect each app once** (in the project folder): Claude: install this plugin. Codex app: `war-room connect codex --yes` (it uses the same settings as the Codex command line, and lets war-room calls wait long enough to stand by).
2. **Tell the commander the plan**, for example "make a 30 s video: Codex writes the script, Claude makes the pictures, Codex checks them". It hires the roles (`use: "app"` for roles that live in an app) and lays the work out as steps, with a **review** step where one app checks another.
3. **Open a chat in each app and say "stand by as writer"** (or maker, checker, commander). It calls `wait_for_work` and waits. Its next task arrives by itself, with the results and file names of the steps before it. It works, reports, and waits again.
4. **Watch the page.** **Steps now** shows each step: who has it, in which app, its latest one-line progress, and when a review sent it back and why. A review that fails sends the work back to the step before (up to 3 rounds, then the commander decides); a pass moves the chain on. You only step in for a question or a risky step.

While a role is standing by in an app, the war room never starts a background copy of it, so nothing is done twice. Standing by costs a little: the chat checks in about once a minute. Say "stop" in that chat to end it.

## Connect other agents

Agents from other companies make debates real arguments and can take helper tasks. Install the agent the usual way (Codex, Gemini CLI or Cursor's `cursor-agent`), then:

```bash
war-room connect codex          # shows exactly what it will change
war-room connect codex --yes    # adds the war-room server to ~/.codex/config.toml (a backup is kept)
```

It also adds a short note to the project's `AGENTS.md` (or `GEMINI.md`) telling that agent to call `war_room_brief` first. `gemini` and `cursor` work the same way. `war-room doctor` shows what is installed and connected. A chat asking to run `connect` needs your yes, because it changes another tool's settings.

The guard hook is Claude Code only. In other agents, keep their own approval settings on for push, deploy and delete.

To add an agent the war room does not know, describe it in `~/.config/war-room/config.json` (never in a project):

```json
{ "agents": { "myagent": { "company": "Acme", "bin": "myagent", "ask": ["--print", "{prompt}"], "work": ["--auto", "{prompt}"] } } }
```

## The page

```bash
war-room up              # page + watcher, opens http://127.0.0.1:4818 (the commander starts it for you)
war-room up --phone      # also prints a private link for your phone on the same Wi-Fi
war-room dashboard       # or write a static .warroom/dashboard.html
```

**Main** tab: a three-line "how this works", the one box to tell the commander anything (its questions sit above the box; tap one to answer, the suggested answer is filled in), your team as a chart with each member's live state, the main goal's progress bar and deadline, today's goals and the 5 most recent events. A daily goal linked to a task ticks itself once the commander verifies that task; one with no task behind it (something you do yourself) has a box you tap to tick it (or `war-room tick --item 2`, `--undo` to untick). **Shelf** tab: the documents you keep to reread (see below). Approvals appear at the top only when something waits on you. Sending from the box starts a background commander to route your words (turn off with `"autoCommander": false` in `.warroom/config.json`); a message to one member starts that member. **Details** tab: every chat and what it is doing, every goal with its checks, all tasks, the memory by kind, open messages and the full log, each list folded after 10 rows.

Under `serve`, answers and thoughts save straight into the war room and the page refreshes itself when anything changes. The static file shows a copy-and-run command instead.

## The shelf

Memory holds one plain sentence per item. For anything longer you want to reread — a learning note, your project's laws, a decision write-up — there is a shelf. Ask the commander ("put docs/notes/01-event-sourcing.md on the shelf"), or run it yourself from the project folder:

```bash
war-room call shelve '{"agent":"commander","path":"docs/notes/01-event-sourcing.md","category":"Learning"}'
war-room call shelve '{"agent":"commander","path":"docs/notes/01-event-sourcing.md","remove":true}'   # take it off
```

**Learning depends on the goal.** When the commander judges a goal it lists what you need to learn for it, or nothing. Each topic becomes one short note on the shelf, under "To learn for: <goal>", marked *Note not written yet* until the commander writes it. **Study bar:** at the end of each note, tap **I've read this** (or `war-room read --note b2`, `--undo` to take it back). Your study bar on the Main tab, under the goal, and on the Shelf counts notes read out of all topics to learn. A goal that needs no learning adds nothing, and the **Shelf** tab only shows when something is on it.

Then open the page, tap **Shelf**, and tap a title: the note opens as a readable page with headings, tables, lists, bold, code blocks and any language (Chinese included). **← Back to the shelf** returns to the list; the page address keeps the open note, and the page does not refresh itself while you read.

- **No copy.** `.warroom/shelf.json` keeps only the title, the file's path, the date it was added and its category. The text is read from the file each time, so the page always shows the file as it is now.
- **Defaults.** The title is the file's first heading and the category is the name of its folder, unless you pass `title` or `category`.
- **Only this project.** Only `.md` files inside the project folder are accepted; paths with `..`, absolute paths elsewhere and links pointing outside are refused, and the page checks every path again before reading, so a `shelf.json` copied in from elsewhere cannot show other files. Nothing on the page is loaded from other sites, and HTML in a note is shown as text, never run.

## Approve from your phone

Start the page in phone mode and open the printed link on your phone (same Wi-Fi):

```bash
war-room up --phone
```

The link carries a secret token; without it the page refuses everything. Keep the link private.

The **Approve** card at the top of Main shows two kinds of request, each with buttons:

- **Actions an agent asked to do**, such as a deploy, push, publish, payment, deletion or key use. Agents raise them with `request_approval`, or the guard raises them by itself.
- **Judged goals waiting for your choice**: Keep / Improved / Later / Drop.

Agents can ask (`request_approval`) and check (`check_approval`), but no tool lets an agent approve. Only your page or your terminal can: `war-room approve --id a1 --yes`.

**The guard acts on phone approvals** (`"remoteApprovals": true` in `.warroom/config.json`, on by default). It handles a risky command this way:

1. Instead of waiting at a terminal prompt nobody is watching, it blocks the command and files an approval request.
2. Once you approve it, that **exact** command may run **once**, within 30 minutes.
3. A changed command needs a new approval.

Nothing is ever approved automatically: only a tap on Approve (confirmed once more on the page) or `war-room approve --yes` counts. Set `remoteApprovals` to `false` to go back to terminal-only prompts.

`notifyCommand` (any shell command, given the message as its argument, e.g. a push script) goes in `~/.config/war-room/config.json`.

## The watcher: one alarm, no polling

The war room is event-driven — a finished task drops its report into the commander's inbox by itself, so nobody checks chats on a timer. The one exception is a chat that dies without reporting. `war-room up` runs the watcher for that (or alone: `war-room watch --every 10`).

Every 10 minutes (default) it tidies the inbox, starts workers for fresh untaken work and, once each morning, wakes the commander (`morningAt`, default `08:00`; `"morningRun": false` turns it off). It also posts a deduped alert to the commander's inbox for any task claimed too long with no report (`staleHours` in `.warroom/config.json`). It also reacts **instantly** to war-room file changes — no 6-minute reply polling: set `notifyCommand` in `~/.config/war-room/config.json` to any shell command (a push script, `osascript` notification, …) and it runs with the message as its argument the moment something changes.

The founder can answer a queued question instantly from any terminal or phone bridge:

```bash
war-room answer --question m7 --text "violet, always"
```

It is recorded as a decision at once and the question closes.

## Tools

| Tool | Who | What |
|---|---|---|
| `war_room_brief` | everyone | Rules, your task, your messages (short) |
| `war_room_status` | everyone | Progress bars, today's goals, each agent's task, last 10 events |
| `remember` / `recall` | everyone | Long-term memory with conflict check |
| `ask_founder` / `founder_answer` | anyone / commander | Questions that memory cannot answer |
| `propose_goal` → `judge_goal` → `decide_goal` → `set_plan` → `set_today` | commander | Goal intake, judging, founder choice, plan (re-planning keeps verified checks and renumbers ids by place) |
| `create_task` / `verify_task` | commander | Hand out and check work |
| `get_task_packet` / `report_done` | workers | Do one packet, report evidence and the files you made; a review step reports `verdict` pass or fail |
| `wait_for_work` | any chat opened by hand | Stand by: get the next task, message or (commander) report as soon as it is ready, then call again |
| `progress` | workers | One line on where you are; shown live on the step board |
| `post_message` / `read_messages` | everyone | Requests, contracts, handoffs between agents |
| `hire` | commander | Add, change or remove a named role on the team (role, what it does, which agent and model) |
| `start_worker` | commander | Start a helper chat in the background (Claude, Codex, Gemini or Cursor) |
| `start_debate` / `debate_result` | commander / everyone | Put one question to several agents; blind answers, then they argue |
| `request_approval` / `check_approval` | everyone | Ask the founder for a yes; check the answer (no tool can approve) |
| `add_feature` | commander | Register a feature built for the founder (page, start command, waiting check); runs only after the founder approves it on the page |
| `shelve` | commander | Put a Markdown file from this project on the founder's shelf to reread on the page, or take it off (`remove`) |

Agent names are self-declared. The commander-only checks keep roles clear between cooperating chats; they are not a security boundary.

## Data

Plain JSON in `<project>/.warroom/`: `memory.json`, `goals.json`, `tasks.json`, `team.json`, `messages.json`, `runs.json`, `debates.json`, `shelf.json` (pointers only), `addons.json` (approval signed on your computer), `duty.json` (which app chats are standing by), `progress.json` (each step's latest line), `log.jsonl`. The engine's list of war rooms lives in `~/.config/war-room/projects.json`. A file lock keeps several agents from overwriting each other. It has no dependencies; needs Node 18+.

## Security

What the war room protects (each one is a test in `test/`, written as the attack it stops):

- **A downloaded project cannot hijack you.** Anything that runs a command (`notifyCommand`) or holds a secret (the phone link, the signing key) lives in `~/.config/war-room/`, never in a project. A planted `.warroom` folder cannot run code, fake an approval or plant a rule. `.warroom/` ignores itself in git by default.
- **Your yes cannot be forged.** Approvals and confirmed rules are signed with a key that exists only on your computer. A copied, hand-edited or future-dated approval is ignored.
- **Chats cannot write the rules.** A chat, or a web page or file a chat read, can only *propose* a rule. It reaches the other chats after you confirm it on the page, or with `war-room confirm-rules --yes` for rules you imported. Everything else in a chat's briefing is labelled as information, not instructions.

- **No self-approval.** No tool lets an agent approve or answer for the founder. The guard blocks a chat that tries the CLI (`war-room approve`, `answer`, `confirm-rules` or `rules --off`), edits `.warroom/` files by hand, or touches `~/.config/war-room/`.
- **The guard cannot be quietly switched off.** It also asks before a chat disables or uninstalls plugins, or edits Claude Code settings or hook files.
- **Approvals are narrow.** Each approval covers one exact command, can be used once, and lapses after 30 minutes.
- **The page is guarded.** It refuses non-localhost hosts (DNS rebinding) and non-JSON posts (cross-site forms), cannot be framed by another site (clickjacking), runs under a strict content policy, and sends no referrer. The phone link is new every time you start `serve --lan`, unless you pass `--keep-link`. The page loads nothing from other sites.
- **Inputs are checked on the server.** Every tool's types, allowed values and required fields are enforced, whatever the client sends.
- **No secrets in memory.** Memory refuses anything that looks like a password, key or card number.
- **No dependencies at all.**

Installing safely:

- Install only from the official repository, and pin a released tag rather than a moving branch.
- Anyone who can push to the repository can change the code every user runs, so maintainers keep two-factor sign-in on.

Known limits, stated honestly:

- **The guard is pattern-based.** It catches the common forms of push, deploy, publish, delete, money, key and plugin commands, and any shell command that touches `.warroom`. A determined agent with shell access on your user account can still phrase a command it does not recognise, or build a file path piece by piece. Keep your agent's own permission settings on for shell commands as a second layer.
- **The guard protects Claude Code only.** Codex, Cursor, Gemini and other agents rely on their own approval settings.
- **Helper chats run in the background.** A Claude helper may edit files and run shell commands; the guard still stops the risky ones and files an approval. Codex, Gemini and Cursor helpers are not covered by the guard: they rely on their own sandbox and approval settings.
- **Debates cost model calls.** Every seat in every round is one call on that agent's plan, so the commander asks you first.
- **`serve --lan` / `up --phone` is plain HTTP on your local network.** Anyone on the same Wi-Fi who sees the link can use it. Use it on networks you trust, and stop it (Ctrl-C) when you are done.
- **Agent names are self-declared.** The commander can record founder answers and goal choices relayed from chat, by design. The guard's approvals can only come from the page or your terminal.

## Tests

```bash
npm test
```
