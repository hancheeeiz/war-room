// The engine: what keeps a war room moving when no chat is open. One background process per computer (started at
// login by `war-room engine install`, which the founder runs) keeps each registered war room's page and watcher up;
// every watcher pass then tidies the inbox, hands fresh untaken work to the team, and wakes the commander once each
// morning when something needs it. Everything here is capped: a few workers at a time, a few restarts per task.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recipes, runStatus, startWorker, which } from './agents.mjs';
import { now, userDir } from './store.mjs';
import { isReady, mayStartCli } from './relay.mjs';

const today = () => now().slice(0, 10);
const num = (v, dflt) => (Number.isFinite(v) ? v : dflt);
const commanderOf = (store) => store.config().commander;

// ── Inbox ────────────────────────────────────────────
// A report's message is done with once its task is checked; a stale alert once the task is no longer stuck; an old
// daily summary once a newer one exists. Closed here so the commander's inbox only holds what still needs it.
// Writes only when something closes, because the watcher redraws on every file change.
export function tidyInbox(store) {
  const tasks = new Map(store.read('tasks').map((t) => [t.id, t]));
  const isDaily = (m) => m.from === 'war-room' && /^Daily check /.test(m.text);
  const newestDaily = (list) => list.filter(isDaily).pop()?.id;
  const why = (m, lastDaily) => {
    if (!m.open) return null;
    const rep = m.kind === 'handoff' && /^Task (t\d+) \(/.exec(m.text);
    const rt = rep && tasks.get(rep[1]);
    if (rt && ['verified', 'rejected'].includes(rt.status)) return `closed by the war room: ${rep[1]} was ${rt.status}`;
    if (rt?.review && rt.status === 'open') return `closed by the war room: ${rep[1]} sent the work back and waits for the fix`;
    const stale = m.from === 'war-room-watch' && /^stale (t\d+) /.exec(m.text);
    if (stale && tasks.get(stale[1])?.status !== 'claimed') return `closed by the war room: ${stale[1]} is no longer stuck`;
    if (isDaily(m) && m.id !== lastDaily) return 'closed by the war room: a newer daily check replaced it';
    return null;
  };
  const messages = store.read('messages');
  if (!messages.some((m) => why(m, newestDaily(messages)))) return 0;
  let closed = 0;
  // Decided again inside the lock, so two watchers never close the newest summary between them.
  store.update('messages', (all) => {
    const last = newestDaily(all);
    for (const m of all) {
      const reply = why(m, last);
      if (reply) { Object.assign(m, { open: false, reply, closedBy: 'war-room', closed: now() }); closed += 1; }
    }
  });
  store.log({ agent: 'war-room', event: 'inbox_tidied', count: closed });
  return closed;
}

export function inboxCounts(store) {
  const commander = commanderOf(store);
  const open = store.read('messages').filter((m) => m.open && (m.to === commander || m.to === 'all'));
  return { open: open.length, oldest: open[0]?.date };
}

// ── Handing out untaken work ─────────────────────────
// Fresh means created (or reassigned) within sweepDays. Older open work is not started blindly: it may be out of date,
// so the commander is shown it and decides (reassign_task restarts it, which makes it fresh again).
export function lastTouched(t) {
  const h = (t.history || []).map((x) => x.date).filter(Boolean).sort().pop();
  return [t.created, t.reassigned, h].filter(Boolean).sort().pop() || '';
}

function sweepCutoff(store) {
  const d = new Date(Date.now() - num(store.config().sweepDays, 3) * 86400e3);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function oldOpenWork(store) {
  const cut = sweepCutoff(store);
  const commander = commanderOf(store);
  return store.read('tasks').filter((t) => ['open', 'rejected'].includes(t.status) && t.agent !== commander && lastTouched(t) < cut);
}

function eventsTodayByAgent(store) {
  const d = today();
  const counts = new Map();
  for (const e of store.readLog(100000)) if (e.at?.startsWith(d)) counts.set(e.agent, (counts.get(e.agent) || 0) + 1);
  return counts;
}

// Start the worker for each fresh, ready, untaken task of a hired team member. Caps: maxWorkers running at once in
// this war room (default 3), maxAutoStarts per task per day (default 3), and no start for a role past the daily
// action cap. Returns what it started and why the rest were left.
export function sweepWork(store) {
  const cfg = store.config();
  if (cfg.autoStartWorkers === false) return { started: [], skipped: [] };
  const team = store.read('team');
  const runs = store.read('runs');
  const running = (name) => { const r = runs.filter((x) => x.name === name).pop(); return !!r && runStatus(r) === 'running'; };
  const tasks = store.read('tasks');
  const cut = sweepCutoff(store);
  const max = num(cfg.maxWorkers, 3);
  const perTask = num(cfg.maxAutoStarts, 3);
  const budget = num(cfg.dailyEventBudget, 300);
  const events = eventsTodayByAgent(store);
  // A role stopped at the guard waits for the founder's yes; restarting it would only hit the guard again.
  const waitingYes = new Set(store.read('approvals').filter((x) => x.status === 'pending').map((x) => x.agent));
  let busy = new Set(runs.filter((r) => runStatus(r) === 'running').map((r) => r.name)).size;
  const started = [];
  const skipped = [];
  const seen = new Set();
  for (const t of tasks) {
    if (!['open', 'rejected'].includes(t.status) || seen.has(t.agent)) continue;
    if (!isReady(t, tasks)) continue;
    if (lastTouched(t) < cut) continue;
    const member = team.find((m) => m.name === t.agent);
    if (!member) continue;
    seen.add(t.agent);
    if (running(t.agent) || !mayStartCli(store, t.agent)) continue;
    const tries = (t.autoStarts || []).filter((x) => x.startsWith(today())).length;
    if (tries >= perTask) { skipped.push({ task: t.id, why: `started ${tries} times today without a report` }); continue; }
    const bin = recipes()[member.use || 'claude']?.bin;
    if (!bin || !which(bin)) { skipped.push({ task: t.id, why: `${member.use || 'claude'} is not installed on this computer` }); continue; }
    if (waitingYes.has(t.agent)) { skipped.push({ task: t.id, why: 'waiting for the founder\'s yes' }); continue; }
    if ((events.get(t.agent) || 0) > budget) { skipped.push({ task: t.id, why: 'past the daily action cap' }); continue; }
    if (busy >= max) { skipped.push({ task: t.id, why: `${max} workers already running` }); continue; }
    try {
      const run = startWorker(store, { name: t.agent, agent: member.use || 'claude', model: member.model });
      store.update('tasks', (all) => { const x = all.find((y) => y.id === t.id); if (x) (x.autoStarts ||= []).push(now()); });
      store.log({ agent: 'war-room', event: 'auto_started', id: t.id, text: `${t.agent} (${run.id})` });
      started.push({ task: t.id, name: t.agent, run: run.id });
      busy += 1;
    } catch (e) {
      skipped.push({ task: t.id, why: e.message });
    }
  }
  return { started, skipped };
}

// Names that did things in the last few days but are neither the commander nor on the team: work happening outside
// the plan, which the commander should hire properly or stop routing to.
export function outsideTeam(store, days = 3) {
  const team = new Set(store.read('team').map((m) => m.name));
  const cut = sweepCutoff({ config: () => ({ sweepDays: days }) });
  const ours = new Set([commanderOf(store), 'founder', 'war-room', 'war-room-watch', 'war-room page', 'founder (war-room page)', 'founder (cli)', undefined, null, '']);
  const counts = new Map();
  for (const e of store.readLog(100000)) {
    if (!e.at || e.at < cut || ours.has(e.agent) || team.has(e.agent) || String(e.agent).startsWith('debate-') || String(e.agent).startsWith('unnamed')) continue;
    counts.set(e.agent, (counts.get(e.agent) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// ── The morning commander run ────────────────────────
export function morningPrompt(name) {
  return `You are "${name}", the war-room commander, started by the war room's morning run. The founder is not here; do not wait for them. Call war_room_brief with agent "${name}", then read_messages. Work the brief top to bottom, routing, never building:
1. Reports waiting: re-run each done check yourself, then verify_task (accept or reject with what you re-ran).
2. Messages: act on each, then close it with read_messages close=[ids] and a one-line plain reply.
3. Plans without dates: call set_plan again with the same milestones and a realistic due date for each (inside the goal's deadline if it has one).
4. Tasks still assigned to you: reassign_task each to the right team member (hire one if no role fits).
5. Old open work: for each, reassign_task to restart it if it still matters; if it no longer fits the plan, remember kind "todo" naming the task and why, so the founder sees it.
6. Open work with nobody on it: start_worker for each.
Ask the founder at most one question (ask_founder, plain words, with your suggested answer), only if memory does not answer it. Finish with remember kind "fact": "Morning run <date>: <what you did, one line>". Never push, deploy, publish, delete data or spend money.`;
}

// What the commander should look at this morning; empty means let it sleep.
export function commanderNeeds(store) {
  const cfg = store.config();
  const tasks = store.read('tasks');
  const goals = store.read('goals').filter((g) => g.status === 'active');
  const need = [];
  // The war room's own daily summary is always there; it is not a reason to wake the commander.
  const open = store.read('messages').filter((m) => m.open && (m.to === cfg.commander || m.to === 'all') && m.from !== 'war-room').length;
  if (open) need.push(`${open} open message(s)`);
  const reported = tasks.filter((t) => t.status === 'reported').length;
  if (reported) need.push(`${reported} report(s) to verify`);
  const mine = tasks.filter((t) => t.agent === cfg.commander && t.status !== 'verified').length;
  if (mine) need.push(`${mine} task(s) still on the commander`);
  if (goals.some((g) => g.milestones?.some((m) => !m.due))) need.push('plans without dates');
  const old = oldOpenWork(store).length;
  if (old) need.push(`${old} old open task(s)`);
  return need;
}

// Once a day, at the first watcher pass after morningAt (default 08:00, local time), wake the commander if anything
// needs it. Off with "morningRun": false in .warroom/config.json. Model: commanderModel, else "sonnet".
export function morningRun(store, { force = false } = {}) {
  const cfg = store.config();
  if (cfg.morningRun === false && !force) return null;
  if (!store.read('goals').some((g) => g.status === 'active') && !force) return null;
  const at = /^\d{2}:\d{2}$/.test(cfg.morningAt || '') ? cfg.morningAt : '08:00';
  if (!force && now().slice(11, 16) < at) return null;
  if (!force && store.readLog(100000).some((e) => e.event === 'morning_run' && e.at?.startsWith(today()))) return null;
  const need = commanderNeeds(store);
  if (!need.length && !force) return null;
  if (!which(recipes().claude.bin)) return { skipped: 'Claude Code is not installed, so the commander cannot be started.' };
  const last = store.read('runs').filter((r) => r.name === cfg.commander).pop();
  if (last && runStatus(last) === 'running') return { skipped: 'the commander is already running' };
  if (!mayStartCli(store, cfg.commander)) return { skipped: 'the commander is on duty in an app and sees this itself' };
  const run = startWorker(store, { name: cfg.commander, agent: 'claude', model: cfg.commanderModel || 'sonnet', prompt: morningPrompt(cfg.commander) });
  store.log({ agent: 'war-room', event: 'morning_run', id: run.id, text: need.join(', ') });
  return { run, need };
}

// ── The engine: registry of war rooms and the login item ─
const REG = () => path.join(userDir(), 'projects.json');

export function registered() {
  try { return JSON.parse(fs.readFileSync(REG(), 'utf8')).filter((p) => p && typeof p.dir === 'string'); } catch { return []; }
}

function saveRegistry(list) {
  fs.writeFileSync(REG(), JSON.stringify(list, null, 2), { mode: 0o600 });
}

// Each war room gets its own page port, kept stable so the founder's bookmarks keep working.
export function register(dir) {
  const abs = path.resolve(dir);
  if (!fs.existsSync(path.join(abs, '.warroom', 'config.json'))) throw new Error(`No war room in ${abs}. Start one there with /war-room first.`);
  const list = registered();
  const have = list.find((p) => p.dir === abs);
  if (have) return have;
  let port = 4818;
  while (list.some((p) => p.port === port)) port += 1;
  const entry = { dir: abs, port, added: now() };
  saveRegistry([...list, entry]);
  return entry;
}

export function unregister(dir) {
  const abs = path.resolve(dir);
  const list = registered();
  saveRegistry(list.filter((p) => p.dir !== abs));
  return list.length !== registered().length;
}

// A fixed PATH for the login item: the folders that hold the coding agents and node, then the system folders. Not the
// installing shell's PATH, which may hold project or temp folders a chat could put a fake "claude" into.
export function enginePath() {
  const dirs = [];
  for (const r of Object.values(recipes())) { const f = which(r.bin); if (f) dirs.push(path.dirname(f)); }
  dirs.push(path.dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin');
  const home = os.homedir();
  const unsafe = (d) => /node_modules|\/tmp\/|^\/private\/var\/|^\/var\/folders\//.test(`${d}/`) || (d.startsWith(home) && !/^(\.local|\.npm-global|\.bun|\.volta|\.nvm|\.claude|bin|Library)\b/.test(path.relative(home, d)));
  return [...new Set(dirs)].filter((d) => !unsafe(d) || d === path.dirname(process.execPath)).join(':');
}

// Windows: a small hidden-window script in the founder's Startup folder starts the engine at login (no admin needed).
export const startupFile = (env = process.env) => path.win32.join(env.APPDATA || path.win32.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'war-room-engine.vbs');
export function vbsText({ node, cli }) {
  const q = (s) => String(s).replace(/"/g, '""');
  return `' War room engine: keeps your war rooms running. Written by "war-room engine install"; remove with "war-room engine uninstall".\r\nCreateObject("WScript.Shell").Run """${q(node)}"" ""${q(cli)}"" engine run", 0, False\r\n`;
}

// Where the login item lives on this computer, and whether it is there.
export function loginItem(platform = process.platform) {
  if (platform === 'darwin') return { file: plistPath(), kind: 'login item (LaunchAgent)' };
  if (platform === 'win32') return { file: startupFile(), kind: 'Startup-folder script' };
  return null;
}

export const enginePidFile = () => path.join(userDir(), 'engine.pid');
export function engineRunning() {
  try { const pid = Number(fs.readFileSync(enginePidFile(), 'utf8')); process.kill(pid, 0); return pid; } catch (e) { return e.code === 'EPERM' ? -1 : null; }
}

export const LABEL = 'com.war-room.engine';
export const plistPath = () => path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The login item: macOS starts `war-room engine run` at login and restarts it if it stops. PATH is copied from the
// founder's shell so the engine finds claude, codex and the rest.
export function plistText({ node, cli, pathEnv, log }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(node)}</string><string>${xml(cli)}</string><string>engine</string><string>run</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(pathEnv)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}
