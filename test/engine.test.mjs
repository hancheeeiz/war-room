import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin/war-room.mjs');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

// Fake home and fake agents that only record how they were started and stay "running" for a moment: no paid calls.
const HOME = tmp('war-room-enginehome-');
const BIN = tmp('war-room-enginebin-');
for (const name of ['claude', 'codex']) {
  fs.writeFileSync(path.join(BIN, name), `#!/bin/sh\necho "${name}|$WAR_ROOM_AGENT|$*" >> "$HOME/calls.txt"\nsleep 4\n`);
  fs.chmodSync(path.join(BIN, name), 0o755);
}
const env = { ...process.env, HOME, WAR_ROOM_HOME: path.join(HOME, '.config', 'war-room'), PATH: `${BIN}${path.delimiter}${process.env.PATH}` };
// The engine is also imported straight into this test process: point it at the fake home and agents too.
Object.assign(process.env, { HOME, WAR_ROOM_HOME: env.WAR_ROOM_HOME, PATH: env.PATH });
const calls = () => { try { return fs.readFileSync(path.join(HOME, 'calls.txt'), 'utf8'); } catch { return ''; } };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } throw new Error('timed out'); };

const run = (dir, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env: { ...env, WAR_ROOM_DIR: dir }, encoding: 'utf8' });
const call = (dir, tool, args) => { const out = run(dir, 'call', tool, JSON.stringify(args)); return { text: out.stdout || out.stderr, json: () => JSON.parse(out.stdout) }; };
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, '.warroom', `${f}.json`), 'utf8'));
const write = (dir, f, v) => fs.writeFileSync(path.join(dir, '.warroom', `${f}.json`), JSON.stringify(v, null, 2));
const config = (dir, patch) => write(dir, 'config', { ...read(dir, 'config'), ...patch });

function project(cfg = {}) {
  const dir = tmp('war-room-engine-');
  run(dir, 'init', '--project', 'demo');
  config(dir, { autoStartWorkers: false, ...cfg });
  call(dir, 'propose_goal', { agent: 'commander', title: 'Ship', founderWords: 'ship' });
  call(dir, 'judge_goal', { agent: 'commander', goalId: 'g1', fit: 'core', cost: 'c', risks: 'r', strongerVersion: 'none', learn: [], recommendation: 'keep', reason: 'ok' });
  call(dir, 'decide_goal', { agent: 'commander', goalId: 'g1', choice: 'keep', founderWords: 'yes' });
  call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones: [{ title: 'A', win: 'w', checks: ['c1', 'c2', 'c3', 'c4'], due: '2099-12-31' }] });
  return dir;
}
const hire = (dir, name, use = 'claude') => call(dir, 'hire', { agent: 'commander', name, role: name, use });
const task = (dir, assignTo, extra = {}) => call(dir, 'create_task', { agent: 'commander', goalId: 'g1', title: `work for ${assignTo}`, assignTo, doneCheck: 'x', ...extra });

test('work goes to team members only, and a chat outside the team is told so', () => {
  const dir = project();
  assert.match(task(dir, 'stranger').text, /not on the team\. hire it first/);
  hire(dir, 'builder');
  assert.equal(task(dir, 'builder').json().task.agent, 'builder');
  assert.match(call(dir, 'reassign_task', { agent: 'commander', taskId: 't1', assignTo: 'stranger', reason: 'x' }).text, /not on the team/);
  assert.match(call(dir, 'war_room_brief', { agent: 'stranger' }).text, /are not on the team/);
  call(dir, 'remember', { agent: 'stranger', kind: 'fact', text: 'stranger did a thing nobody tracked' });
  assert.match(call(dir, 'war_room_brief', { agent: 'commander' }).text, /## Chats working outside the team[\s\S]*- stranger: \d+ actions/);
  config(dir, { teamOnly: false });
  assert.equal(task(dir, 'stranger').json().task.agent, 'stranger');
});

test('the inbox closes itself: checked reports, unstuck alerts and old daily summaries', () => {
  const dir = project();
  hire(dir, 'builder');
  task(dir, 'builder', { checkId: 'g1.m1.c1' });
  call(dir, 'get_task_packet', { agent: 'builder' });
  call(dir, 'report_done', { agent: 'builder', taskId: 't1', summary: 'done', evidence: 'ok' });
  assert.equal(read(dir, 'messages').filter((m) => m.open).length, 1);
  call(dir, 'verify_task', { agent: 'commander', taskId: 't1', accepted: true, howChecked: 're-ran it' });
  const m = read(dir, 'messages')[0];
  assert.equal(m.open, false);
  assert.match(m.reply, /t1 was verified/);
  // Old reports from before this version (106 were open in a real war room) close on the next watcher pass.
  const msgs = read(dir, 'messages');
  msgs.push({ id: 2, from: 'builder', to: 'commander', kind: 'handoff', text: 'Task t1 (old copy) reported done: x', date: '2026-11-06 10:00', open: true });
  msgs.push({ id: 3, from: 'builder', to: 'commander', kind: 'handoff', text: 'Can you look at the API?', date: '2026-11-06 10:00', open: true });
  write(dir, 'messages', msgs);
  run(dir, 'daily');
  run(dir, 'daily');
  const after = read(dir, 'messages');
  assert.equal(after.find((x) => x.id === 2).open, false);
  assert.equal(after.find((x) => x.id === 3).open, true, 'a real question stays open');
  const dailies = after.filter((x) => x.from === 'war-room' && x.text.startsWith('Daily check'));
  assert.equal(dailies.length, 2);
  assert.deepEqual(dailies.map((x) => x.open), [false, true], 'only the newest daily summary stays open');
  assert.match(dailies[1].text, /Inbox: 2 open message\(s\)/);
});

test('the sweep starts fresh untaken work, a few at a time, and leaves old work to the commander', async () => {
  const dir = project({ maxWorkers: 2 });
  for (const n of ['a', 'b', 'c']) { hire(dir, n, n === 'c' ? 'codex' : 'claude'); task(dir, n); }
  hire(dir, 'old');
  task(dir, 'old');
  const tasks = read(dir, 'tasks');
  tasks.find((t) => t.agent === 'old').created = '2026-01-01 09:00';
  write(dir, 'tasks', tasks);
  config(dir, { autoStartWorkers: true });
  const { sweepWork } = await import(`${ROOT}/server/engine.mjs`);
  process.env.WAR_ROOM_HOME = env.WAR_ROOM_HOME;
  const { Store } = await import(`${ROOT}/server/store.mjs`);
  const PATH = process.env.PATH;
  process.env.PATH = env.PATH;
  try {
    const s = sweepWork(new Store(path.join(dir, '.warroom')));
    assert.deepEqual(s.started.map((x) => x.name), ['a', 'b']);
    assert.match(s.skipped.map((x) => x.why).join(), /2 workers already running/);
    await until(() => calls().split('\n').filter(Boolean).length >= 2);
    assert.ok(!/\|old\|/.test(calls()), 'old work is not started blindly');
    const brief = call(dir, 'war_room_brief', { agent: 'commander' }).text;
    assert.match(brief, /## Old open work[\s\S]*t4 old/);
    // The same role is not started twice while it runs.
    assert.equal(sweepWork(new Store(path.join(dir, '.warroom'))).started.length, 0);
    assert.ok(read(dir, 'tasks').find((t) => t.agent === 'a').autoStarts.length === 1);
    // Reassigning old work makes it fresh, so the next sweep starts it.
    assert.ok(read(dir, 'tasks').find((t) => t.id === 't4'));
  } finally { process.env.PATH = PATH; }
});

test('a task restarted three times today without a report is not started again', async () => {
  const dir = project();
  hire(dir, 'flaky');
  task(dir, 'flaky');
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} 00:01`;
  const tasks = read(dir, 'tasks');
  tasks[0].autoStarts = [stamp, stamp, stamp];
  write(dir, 'tasks', tasks);
  config(dir, { autoStartWorkers: true });
  process.env.WAR_ROOM_HOME = env.WAR_ROOM_HOME;
  const { sweepWork } = await import(`${ROOT}/server/engine.mjs`);
  const { Store } = await import(`${ROOT}/server/store.mjs`);
  const s = sweepWork(new Store(path.join(dir, '.warroom')));
  assert.equal(s.started.length, 0);
  assert.match(s.skipped[0].why, /started 3 times today/);
});

test('morning run: wakes the commander once a day, only when something needs it', async () => {
  const dir = project({ morningAt: '00:00' });
  const brief = (d) => call(d, 'war_room_brief', { agent: 'commander' });
  brief(dir);
  // Nothing needs the commander: no run.
  const { morningRun } = await import(`${ROOT}/server/engine.mjs`);
  process.env.WAR_ROOM_HOME = env.WAR_ROOM_HOME;
  const { Store } = await import(`${ROOT}/server/store.mjs`);
  const PATH = process.env.PATH;
  process.env.PATH = env.PATH;
  try {
    const store = new Store(path.join(dir, '.warroom'));
    assert.equal(morningRun(store), null);
    call(dir, 'post_message', { agent: 'founder', to: 'commander', kind: 'info', text: 'Please look at the login bug' });
    const m = morningRun(store);
    assert.ok(m.run, 'started');
    assert.deepEqual(m.need, ['1 open message(s)']);
    await until(() => /claude\|commander\|.*morning run/.test(calls()));
    assert.match(calls(), /--model sonnet/);
    assert.equal(morningRun(store), null, 'once a day');
    config(dir, { morningRun: false });
    assert.equal(morningRun(store, {}), null);
  } finally { process.env.PATH = PATH; }
});

test('engine: the list of war rooms, stable page ports, and the login item', () => {
  const a = project();
  const b = project();
  assert.match(run(a, 'engine', 'add').stdout, /page port 4818/);
  assert.match(run(b, 'engine', 'add').stdout, /page port 4819/);
  assert.match(run(a, 'engine', 'add').stdout, /page port 4818/, 'adding twice keeps the port');
  assert.match(run(tmp('war-room-none-'), 'engine', 'add').stderr, /No war room/);
  const st = run(a, 'engine', 'status').stdout;
  assert.match(st, /Engine: off/);
  assert.match(st, /○ .*4818/);
  if (process.platform === 'darwin') {
    const out = run(a, 'engine', 'install', '--no-load').stdout;
    assert.match(out, /Login item written/);
    const plist = fs.readFileSync(path.join(HOME, 'Library', 'LaunchAgents', 'com.war-room.engine.plist'), 'utf8');
    assert.match(plist, /<string>engine<\/string><string>run<\/string>/);
    assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
    // A fixed PATH: system folders and where the agents live, never a temp or project folder a chat could plant a fake agent in.
    assert.match(plist, /<key>PATH<\/key><string>[^<]*\/usr\/bin:\/bin/);
    assert.ok(!plist.includes(BIN), 'no temp folder in the login item PATH');
    assert.match(run(a, 'engine', 'status').stdout, /Engine: on/);
    run(a, 'engine', 'uninstall', '--no-load');
    assert.ok(!fs.existsSync(path.join(HOME, 'Library', 'LaunchAgents', 'com.war-room.engine.plist')));
  }
  assert.match(run(b, 'engine', 'remove').stdout, /Removed/);
});

test('engine run keeps each registered war room up, and the guard asks before a chat turns it on', async () => {
  const dir = project();
  config(dir, { morningRun: false });
  const port = 5900 + Math.floor(Math.random() * 300);
  const reg = path.join(env.WAR_ROOM_HOME, 'projects.json');
  const saved = fs.existsSync(reg) ? fs.readFileSync(reg, 'utf8') : null;
  fs.writeFileSync(reg, JSON.stringify([{ dir, port }]));
  const { spawn } = await import('node:child_process');
  const eng = spawn(process.execPath, [CLI, 'engine', 'run'], { cwd: dir, env, stdio: 'ignore' });
  try {
    await until(() => spawnSync('curl', ['-s', `http://127.0.0.1:${port}/api/version`]).stdout.length > 0, 10000);
    assert.ok(fs.existsSync(path.join(dir, '.warroom', 'up.json')));
  } finally {
    eng.kill();
    try { process.kill(JSON.parse(fs.readFileSync(path.join(dir, '.warroom', 'up.json'), 'utf8')).pid); } catch {}
    if (saved === null) fs.rmSync(reg, { force: true }); else fs.writeFileSync(reg, saved);
  }
  const guard = (command) => spawnSync(process.execPath, [CLI, 'hook-guard'], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8', env: { ...env, WAR_ROOM_DIR: '/nonexistent' } }).stdout;
  assert.match(guard('war-room engine install'), /"ask"/);
  assert.match(guard('launchctl bootstrap gui/501 x.plist'), /start by itself/);
  const write = spawnSync(process.execPath, [CLI, 'hook-guard'], { input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: `${HOME}/Library/LaunchAgents/evil.plist` } }), encoding: 'utf8', env: { ...env, WAR_ROOM_DIR: '/nonexistent' } }).stdout;
  assert.match(write, /start by itself/);
  assert.equal(guard('war-room engine status'), '', 'looking is fine');
});

test('review fixes: no wake-up for the daily summary alone, no restart while waiting for a yes, one watcher per war room', async () => {
  const dir = project({ morningAt: '00:00' });
  const { morningRun, sweepWork } = await import(`${ROOT}/server/engine.mjs`);
  const { Store } = await import(`${ROOT}/server/store.mjs`);
  const store = new Store(path.join(dir, '.warroom'));
  run(dir, 'daily');
  assert.equal(morningRun(store), null, 'the war room\'s own summary does not wake a paid commander run');
  hire(dir, 'shipper');
  task(dir, 'shipper');
  call(dir, 'request_approval', { agent: 'shipper', action: 'git push', why: 'ship' });
  config(dir, { autoStartWorkers: true });
  assert.match(sweepWork(store).skipped[0].why, /waiting for the founder's yes/);
  hire(dir, 'ghost', 'nosuchagent');
  task(dir, 'ghost');
  assert.ok(sweepWork(store).skipped.some((x) => /nosuchagent is not installed/.test(x.why)));
  // A second `up` while one is running (or starting) refuses instead of running a second watcher.
  fs.writeFileSync(path.join(dir, '.warroom', 'up.json'), JSON.stringify({ pid: process.pid, starting: 'now' }));
  assert.match(run(dir, 'up', '--no-open', '--port', '5999').stdout, /already up/);
  fs.writeFileSync(path.join(dir, '.warroom', 'up.json'), JSON.stringify({ pid: 999999, starting: 'old' }));
  const { spawn } = await import('node:child_process');
  config(dir, { autoStartWorkers: false, morningRun: false });
  const port = 6300 + Math.floor(Math.random() * 300);
  const up = spawn(process.execPath, [CLI, 'up', '--no-open', '--port', String(port)], { cwd: dir, env: { ...env, WAR_ROOM_DIR: dir }, stdio: 'ignore' });
  try {
    await until(() => { try { return JSON.parse(fs.readFileSync(path.join(dir, '.warroom', 'up.json'), 'utf8')).pid === up.pid; } catch { return false; } });
  } finally { up.kill(); }
  const guard = spawnSync(process.execPath, [CLI, 'hook-guard'], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'war-room morning' } }), encoding: 'utf8', env: { ...env, WAR_ROOM_DIR: '/nonexistent' } }).stdout;
  assert.match(guard, /extra paid commander run/);
});
