// Other coding agents: find which are installed, start worker chats, and run debates where agents from different
// companies answer the same question blind, then argue with each other's answers.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextId, now, userConfig } from './store.mjs';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLI = path.join(PLUGIN_ROOT, 'bin', 'war-room.mjs');

// Built-in recipes. {prompt} and {model} are filled in; an argument holding only {model} is dropped when no model is
// given. "ask" answers read-only (debates); "work" may edit files (worker chats). Only Claude Code also gets the
// war-room guard hook; the others rely on their own approval settings.
const RECIPES = {
  claude: { company: 'Anthropic', bin: 'claude', ask: ['-p', '{prompt}', '--tools', 'Read,Grep,Glob', '--model', '{model}'], work: ['-p', '{prompt}', '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash,mcp__war-room,mcp__plugin_war-room_war-room', '--model', '{model}'], models: ['opus', 'sonnet', 'haiku'] },
  codex: { company: 'OpenAI', bin: 'codex', ask: ['exec', '-c', 'model="{model}"', '{prompt}'], work: ['exec', '--full-auto', '-c', 'model="{model}"', '{prompt}'] },
  // Gemini refuses headless runs in a folder it was not told to trust; --skip-trust trusts this project for the run.
  // "plan" is its read-only mode; workers may edit files (auto_edit) but still ask before shell commands.
  gemini: { company: 'Google', bin: 'gemini', ask: ['--skip-trust', '--approval-mode', 'plan', '-m', '{model}', '-p', '{prompt}'], work: ['--skip-trust', '--approval-mode', 'auto_edit', '-m', '{model}', '-p', '{prompt}'] },
  cursor: { company: 'Cursor', bin: 'cursor-agent', ask: ['-p', '--mode', 'ask', '--model', '{model}', '--output-format', 'text', '{prompt}'], work: ['-p', '--model', '{model}', '--output-format', 'text', '{prompt}'] },
  ollama: { company: 'local (Ollama)', bin: 'ollama', ask: ['run', '{model}', '{prompt}'], needsModel: true },
};

// The founder can add or change agents in ~/.config/war-room/config.json ("agents"), never in a project:
// a downloaded project must not be able to make the war room run its commands.
export function recipes() {
  const out = structuredClone(RECIPES);
  for (const [name, r] of Object.entries(userConfig().agents || {})) out[name] = { company: name, ...out[name], ...r };
  return out;
}

export function which(bin) {
  if (bin.includes('/')) return fs.existsSync(bin) ? bin : null;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const f = path.join(dir, bin);
    try { if (fs.statSync(f).isFile()) return f; } catch {}
  }
  return null;
}

export function installed() {
  return Object.entries(recipes()).filter(([, r]) => which(r.bin)).map(([name, r]) => ({ name, ...r }));
}

// "claude:opus" → { agent: 'claude', model: 'opus' }
export function parseSeat(spec) {
  const [agent, ...m] = String(spec).split(':');
  return { agent, model: m.join(':') || undefined, seat: spec };
}

function fill(args, { prompt, model }) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.includes('{model}') && !model) {
      // Drop the flag in front of a bare {model} too ("--model {model}").
      if (a === '{model}' && out.length && String(out[out.length - 1]).startsWith('-')) out.pop();
      continue;
    }
    out.push(a.replace('{prompt}', prompt).replace('{model}', model || ''));
  }
  return out;
}

export function commandFor(seat, mode, prompt) {
  const r = recipes()[seat.agent];
  if (!r) throw new Error(`Unknown agent "${seat.agent}". Known: ${Object.keys(recipes()).join(', ')}.`);
  if (!r[mode]) throw new Error(`${seat.agent} cannot be used for ${mode === 'work' ? 'worker chats' : 'debates'}.`);
  if (r.needsModel && !seat.model) throw new Error(`${seat.agent} needs a model, e.g. ${seat.agent}:llama3.`);
  return { bin: which(r.bin) || r.bin, args: fill(r[mode], { prompt, model: seat.model }), company: r.company };
}

// Default debate seats: one per installed company. If fewer than three, fill with different Claude models,
// and say plainly that agreement between seats from one company is weak evidence.
export function defaultSeats() {
  const have = installed().filter((r) => r.ask && !r.needsModel);
  const seats = have.map((r) => ({ agent: r.name, seat: r.name }));
  const claude = have.find((r) => r.name === 'claude');
  if (claude && seats.length < 3) {
    seats.splice(seats.findIndex((s) => s.agent === 'claude'), 1);
    for (const m of claude.models.slice(0, 3 - seats.length)) seats.push({ agent: 'claude', model: m, seat: `claude:${m}` });
  }
  return seats;
}

function claudeHasPluginInstalled() {
  try { return /"war-room@/.test(fs.readFileSync(path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json'), 'utf8')); } catch { return false; }
}

// ── Worker chats ─────────────────────────────────────
export function workerPrompt(name) {
  return `You are "${name}" in the war room. Call war_room_brief with agent "${name}", then get_task_packet. Do only that task, inside its files. Check your work, then call report_done with the evidence (and notVerified for anything you could not check). Never push, deploy, publish, delete data or spend money: those need the founder's yes. If the guard stopped a command and the founder has since approved it (your messages, or check_approval), run that exact same command again now. If you are blocked, remember it as kind "problem" and post_message to the commander.`;
}

export function startWorker(store, { name, agent = 'claude', model }) {
  if (!/^[\w.-]{1,40}$/.test(name)) throw new Error('Worker name: letters, numbers, dot, dash or underscore only.');
  const seat = { agent, model };
  const cmd = commandFor(seat, 'work', workerPrompt(name));
  if (agent === 'claude' && !claudeHasPluginInstalled()) cmd.args.push('--plugin-dir', PLUGIN_ROOT);
  const project = path.dirname(store.root);
  fs.mkdirSync(path.join(store.root, 'runs'), { recursive: true });
  const log = path.join(store.root, 'runs', `${name}-${Date.now()}.log`);
  const fd = fs.openSync(log, 'a');
  const child = spawn(cmd.bin, cmd.args, { cwd: project, detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, WAR_ROOM_AGENT: name, WAR_ROOM_DIR: project } });
  child.unref();
  fs.closeSync(fd);
  return store.update('runs', (runs) => {
    const run = { id: nextId(runs, 'r'), name, agent, model, company: cmd.company, pid: child.pid, started: now(), startedMs: Date.now(), log: path.relative(project, log) };
    runs.push(run);
    store.log({ agent: 'war-room', event: 'worker_started', id: run.id, text: `${name} (${agent}${model ? ` ${model}` : ''})` });
    return run;
  });
}

export function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

export function runStatus(run) {
  return alive(run.pid) ? 'running' : 'finished';
}

// A background worker stops when it hits something that needs the founder's yes. Once the founder approves,
// start it again with the same agent and model so the work carries on without anyone opening a chat.
export function resumeAfterApproval(store, ap) {
  if (ap.status !== 'approved' || ap.type === 'rule') return null;
  const runs = store.read('runs').filter((r) => r.name === ap.agent);
  const last = runs[runs.length - 1];
  if (!last || runStatus(last) === 'running') return null;
  if (!store.read('tasks').some((t) => t.agent === ap.agent && ['claimed', 'open', 'rejected'].includes(t.status))) return null;
  return startWorker(store, { name: last.name, agent: last.agent, model: last.model });
}

// Workers whose process ended while their task is still unreported: the commander should look at the log.
export function stoppedWorkers(store) {
  const tasks = store.read('tasks');
  const latest = new Map();
  for (const r of store.read('runs')) latest.set(r.name, r);
  return [...latest.values()].filter((r) => runStatus(r) === 'finished' && tasks.some((t) => t.agent === r.name && ['claimed', 'open', 'rejected'].includes(t.status)));
}

// ── Debates ──────────────────────────────────────────
const FINAL = /^\s*\**FINAL\**\s*:\s*(.+)$/im;

function round1Prompt(q) {
  return `Several AI agents from different companies are each answering this question on their own. Give your honest, independent answer. You may read files in this project, but change nothing.

Question: ${q}

Be concrete and brief (under 300 words). Say what you are unsure of. End with one line exactly:
FINAL: <your answer in one line>`;
}

function round2Prompt(q, mine, others) {
  return `Several AI agents from different companies answered this question on their own. Now argue.

Question: ${q}

Your first answer:
${mine}

The other agents' answers (anonymous):
${others.map((o, i) => `--- Agent ${String.fromCharCode(65 + i)} ---\n${o}`).join('\n')}

Say where the others are wrong and where they are right. Keep your answer if it was right, even if everyone disagrees; change it only if a specific argument shows you were wrong, and name that argument. Under 250 words. End with one line exactly:
FINAL: <your answer in one line>`;
}

// Agent CLIs bury the real reason (no credit, bad key, quota) inside long error dumps; pull out the plain part.
function whyFailed(out) {
  const known = out.match(/(prepayment credits are depleted|quota[^"\\.]*|API key not valid[^"\\.]*|not logged in[^"\\.]*|PERMISSION_DENIED[^"\\]*|not running in a trusted directory)/i);
  if (known) return known[1].replace(/\s+/g, ' ').trim();
  return out.trim().split('\n').filter((l) => l.trim() && !/^\s+at /.test(l)).pop();
}

function ask(seat, prompt, cwd, timeoutMs) {
  return new Promise((resolve) => {
    let cmd;
    try { cmd = commandFor(seat, 'ask', prompt); } catch (e) { return resolve({ ok: false, text: e.message, ms: 0 }); }
    const t = Date.now();
    execFile(cmd.bin, cmd.args, { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, WAR_ROOM_AGENT: `debate-${seat.seat}` } }, (err, stdout, stderr) => {
      const text = String(stdout || '').trim();
      if (err && !text) return resolve({ ok: false, text: `Failed: ${err.killed ? 'timed out' : whyFailed(String(stderr)) || err.message}`.slice(0, 500), ms: Date.now() - t });
      resolve({ ok: true, text: text.slice(0, 12000), final: text.match(FINAL)?.[1]?.trim(), ms: Date.now() - t });
    });
  });
}

export function createDebate(store, { question, seats, rounds = 2, by }) {
  const list = (seats?.length ? seats.map(parseSeat) : defaultSeats());
  if (list.length < 2) throw new Error('A debate needs at least two agents. Install another (Codex, Gemini CLI, Cursor) or name Claude models, e.g. claude:opus,claude:sonnet.');
  for (const s of list) commandFor(s, 'ask', 'x');
  const companies = new Set(list.map((s) => recipes()[s.agent]?.company));
  return store.update('debates', (debates) => {
    const d = { id: nextId(debates, 'd'), question, seats: list, rounds: Math.min(Math.max(rounds, 1), 3), by, status: 'queued', created: now(), companies: [...companies], results: [] };
    debates.push(d);
    store.log({ agent: by, event: 'debate_started', id: d.id, text: question });
    return d;
  });
}

// Runs in its own process (war-room debate --id dN), so a long debate never blocks a chat.
export async function runDebate(store, id, { timeoutMs = 10 * 60e3 } = {}) {
  const cwd = path.dirname(store.root);
  const d = store.read('debates').find((x) => x.id === id);
  if (!d) throw new Error(`No debate ${id}.`);
  const save = (patch) => store.update('debates', (ds) => Object.assign(ds.find((x) => x.id === id), patch));
  save({ status: 'running', pid: process.pid });
  const results = [];
  let prev = null;
  for (let r = 0; r < d.rounds; r += 1) {
    const answers = await Promise.all(d.seats.map((seat, i) => {
      if (!prev) return ask(seat, round1Prompt(d.question), cwd, timeoutMs);
      if (!prev[i].ok) return Promise.resolve({ ok: false, text: 'Skipped: no first answer.', ms: 0 });
      const others = prev.filter((x, j) => j !== i && x.ok).map((x) => x.text);
      return others.length ? ask(seat, round2Prompt(d.question, prev[i].text, others), cwd, timeoutMs) : Promise.resolve(prev[i]);
    }));
    results.push(answers.map((a, i) => ({ seat: d.seats[i].seat, ...a })));
    save({ results });
    prev = answers;
  }
  const finals = results[results.length - 1].map((a) => ({ seat: a.seat, final: a.ok ? (a.final || '(no FINAL line)') : a.text }));
  save({ status: 'done', finished: now(), finals });
  store.log({ agent: 'war-room', event: 'debate_done', id, text: finals.map((f) => `${f.seat}: ${f.final}`).join(' | ').slice(0, 300) });
  return store.read('debates').find((x) => x.id === id);
}

export function launchDebate(store, id) {
  const child = spawn(process.execPath, [CLI, 'debate', '--id', id], { cwd: path.dirname(store.root), detached: true, stdio: 'ignore', env: { ...process.env, WAR_ROOM_DIR: path.dirname(store.root) } });
  child.unref();
  return child.pid;
}

// ── Connecting other agents to the war room ──────────
export const CONNECT = {
  codex: { file: () => path.join(os.homedir(), '.codex', 'config.toml'), notes: 'AGENTS.md' },
  gemini: { file: () => path.join(os.homedir(), '.gemini', 'settings.json'), notes: 'GEMINI.md' },
  cursor: { file: () => path.join(os.homedir(), '.cursor', 'mcp.json'), notes: 'AGENTS.md' },
};

const NOTE = `<!-- war-room -->
## War room
This project has a war room. At the start of every session call the war-room tool \`war_room_brief\` with your agent name, then \`get_task_packet\`. Finish with \`report_done\` and your evidence. Never push, deploy, publish, delete data or spend money without the founder's yes.
<!-- /war-room -->
`;

// Returns what would change; writes only when write is true.
export function connectAgent(agent, { project, write = false } = {}) {
  const c = CONNECT[agent];
  if (!c) throw new Error(`Connect one of: ${Object.keys(CONNECT).join(', ')}.`);
  const file = c.file();
  const server = { command: process.execPath, args: [path.join(PLUGIN_ROOT, 'server', 'index.mjs')] };
  const changes = [];
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (agent === 'codex') {
    if (!/\[mcp_servers\.war-room\]/.test(text)) {
      text += `${text && !text.endsWith('\n') ? '\n' : ''}\n[mcp_servers.war-room]\ncommand = ${JSON.stringify(server.command)}\nargs = ${JSON.stringify(server.args)}\n`;
      changes.push(`add the war-room server to ${file}`);
    }
  } else {
    let cfg = {};
    try { cfg = text ? JSON.parse(text) : {}; } catch { throw new Error(`${file} is not valid JSON; fix it first.`); }
    if (!cfg.mcpServers?.['war-room']) {
      cfg.mcpServers = { ...(cfg.mcpServers || {}), 'war-room': server };
      text = `${JSON.stringify(cfg, null, 2)}\n`;
      changes.push(`add the war-room server to ${file}`);
    }
  }
  const notes = project ? path.join(project, c.notes) : null;
  const notesText = notes && fs.existsSync(notes) ? fs.readFileSync(notes, 'utf8') : '';
  if (notes && !notesText.includes('<!-- war-room -->')) changes.push(`add a short war-room note to ${notes}`);
  if (write && changes.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.before-war-room`);
    fs.writeFileSync(file, text);
    if (notes && !notesText.includes('<!-- war-room -->')) fs.writeFileSync(notes, `${notesText}${notesText && !notesText.endsWith('\n') ? '\n' : ''}${notesText ? '\n' : ''}${NOTE}`);
  }
  return { file, changes, installed: !!which(recipes()[agent].bin) };
}

export function isConnected(agent) {
  try {
    const text = fs.readFileSync(CONNECT[agent].file(), 'utf8');
    return agent === 'codex' ? /\[mcp_servers\.war-room\]/.test(text) : !!JSON.parse(text).mcpServers?.['war-room'];
  } catch { return false; }
}
