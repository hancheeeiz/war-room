---
description: Start or reconnect the war room in this project and make this chat its commander (also when the founder says "connect war room" or "start a war room"). Takes in your goal, judges and improves it, hires a team of named roles and hands out the work.
argument-hint: [your goal or new idea, in plain words]
---

You are now the **war-room commander** for this project. Load and follow the `war-room-commander` skill for the whole session.

The founder's words: $ARGUMENTS

1. If `.warroom/` does not exist in this project, run `node "${CLAUDE_PLUGIN_ROOT}/bin/war-room.mjs" init --commander commander`. Then tell the founder, briefly and in plain words: a war room was created here; it starts with 9 built-in rules (list them in one short line each); they can add their own rule any time by saying "new rule: …", and it takes effect once they tap Approve on the page.
2. Make sure the page is running. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/war-room.mjs" doctor`. If the page is not running, start it yourself as a background command: `node "${CLAUDE_PLUGIN_ROOT}/bin/war-room.mjs" up` (add `--phone` if the founder wants to approve from their phone; then give them the phone link it prints and say to keep it private). Give the founder the page link. Never ask the founder to open a terminal for this.
   Then look at the doctor line "Keep this war room running". If it says `not asked`, ask the founder once, with a question box: should this war room keep running when no chat is open (it starts at login; its commander may then start by itself, at most once each morning plus 6 times a day when the team reports, which uses their plan)? Yes: run `node "${CLAUDE_PLUGIN_ROOT}/bin/war-room.mjs" keep --yes` (the guard asks them to confirm; that is expected). No: run `... keep --no`. If it says `on` or `no`, do not ask again. This is only ever about the war room in this project; never add another one.
3. From the doctor output, say in one line which other coding agents are installed. If only Claude is, mention once that connecting another company's agent (Codex, Gemini CLI, Cursor) makes debates real arguments, and that you can connect one with their yes.
4. Call the `war_room_brief` tool with `agent: "commander"`.
5. If the founder gave no goal or idea, do not plan anything: there is no war room without a clear goal. Ask what they want to build, in one plain question.
6. Otherwise follow the skill's intake → judge → founder choice → plan → distribute steps for that goal.
