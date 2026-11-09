import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin/war-room.mjs');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const HOME = tmp('war-room-addonhome-');
const env = { ...process.env, HOME, WAR_ROOM_HOME: path.join(HOME, '.config', 'war-room') };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } throw new Error('timed out'); };

function project() {
  const dir = tmp('war-room-addon-');
  spawnSync(process.execPath, [CLI, 'init', '--project', 'demo'], { cwd: dir, env });
  // A home-made feature, like a lesson page: two questions wait for the commander.
  fs.writeFileSync(path.join(dir, 'waiting.sh'), 'echo "Lesson 04: why does the seed repeat?"\necho "Lesson 07: more detail on sound change"\n');
  return dir;
}
const run = (dir, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env: { ...env, WAR_ROOM_DIR: dir }, encoding: 'utf8' });
const call = (dir, tool, args) => { const out = run(dir, 'call', tool, JSON.stringify(args)); return { text: out.stdout || out.stderr, json: () => JSON.parse(out.stdout) }; };
const page = (dir) => fs.readFileSync(run(dir, 'dashboard').stdout.trim(), 'utf8');
const brief = (dir) => call(dir, 'war_room_brief', { agent: 'commander' }).text;
const lessons = { agent: 'commander', name: 'lessons', title: '學習課', purpose: 'Lessons with notes and questions for the commander', url: 'http://localhost:4820/', start: 'touch started.txt', waiting: 'touch ran-waiting.txt; sh waiting.sh' };

test('add_feature: commander only, a local page only, and something to show', () => {
  const dir = project();
  assert.match(call(dir, 'add_feature', { ...lessons, agent: 'designer' }).text, /Only the commander/);
  assert.match(call(dir, 'add_feature', { ...lessons, name: 'My Lessons' }).text, /lowercase letters/);
  assert.match(call(dir, 'add_feature', { ...lessons, url: 'https://evil.example/' }).text, /page on this computer/);
  assert.match(call(dir, 'add_feature', { agent: 'commander', name: 'empty', title: 'Empty' }).text, /at least a url/);
  assert.match(call(dir, 'add_feature', { agent: 'commander', name: 'x', url: 'http://localhost:4821/' }).text, /needs a title/);
  assert.match(call(dir, 'add_feature', lessons).json().next, /waiting for their approval/);
});

test('nothing runs before the founder approves; the page shows exactly what it would run', () => {
  const dir = project();
  call(dir, 'add_feature', lessons);
  assert.match(brief(dir), /## Add-ons[\s\S]*lessons \(學習課\): waiting for the founder's approval/);
  const html = page(dir);
  assert.match(html, /Your tools/);
  assert.match(html, /data-addon="lessons" data-on="1">Approve/);
  // The page's risky-step approvals already use data-approve; an add-on button using it would run their handler.
  assert.doesNotMatch(html, /data-addon="[^"]*" data-approve/);
  assert.match(html, /touch ran-waiting\.txt; sh waiting\.sh/);
  assert.doesNotMatch(html, />Open</);
  assert.equal(run(dir, 'addon', '--start').stdout.trim(), 'Nothing to start (not approved, no start command, or already running).');
  assert.ok(!fs.existsSync(path.join(dir, 'ran-waiting.txt')));
  assert.ok(!fs.existsSync(path.join(dir, 'started.txt')));
});

test('a chat cannot approve it by editing the file: the approval is signed on this computer', () => {
  const dir = project();
  call(dir, 'add_feature', lessons);
  const f = path.join(dir, '.warroom', 'addons.json');
  const a = JSON.parse(fs.readFileSync(f, 'utf8'));
  a[0].sig = 'a'.repeat(64);
  fs.writeFileSync(f, JSON.stringify(a));
  assert.match(brief(dir), /waiting for the founder's approval/);
  assert.ok(!fs.existsSync(path.join(dir, 'ran-waiting.txt')));
});

test('approved: the page links it and shows what waits; the brief and the daily check list it', async () => {
  const dir = project();
  call(dir, 'add_feature', lessons);
  assert.match(run(dir, 'addon', '--name', 'lessons', '--approve').stdout, /lessons: approved/);
  assert.match(brief(dir), /lessons \(學習課\): 2 waiting\n  · Lesson 04: why does the seed repeat\?\n  · Lesson 07/);
  const html = page(dir);
  assert.match(html, /<span class="pill warn">2 waiting<\/span>/);
  assert.match(html, /href="http:\/\/localhost:4820\/"[^>]*>Open</);
  assert.match(html, /Lesson 04: why does the seed repeat\?/);
  call(dir, 'propose_goal', { agent: 'commander', title: 'Learn', founderWords: 'learn' });
  call(dir, 'judge_goal', { agent: 'commander', goalId: 'g1', fit: 'core', cost: 'c', risks: 'r', strongerVersion: 'none', learn: [], recommendation: 'keep', reason: 'ok' });
  call(dir, 'decide_goal', { agent: 'commander', goalId: 'g1', choice: 'keep', founderWords: 'yes' });
  call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones: [{ title: 'A', win: 'w', checks: ['c'], due: '2099-12-31' }] });
  assert.match(run(dir, 'daily').stdout, /學習課: 2 waiting\./);
  run(dir, 'addon', '--start');
  await until(() => fs.existsSync(path.join(dir, 'started.txt')));
});

test('changing what it runs needs a new approval; a new title does not', () => {
  const dir = project();
  call(dir, 'add_feature', lessons);
  run(dir, 'addon', '--name', 'lessons', '--approve');
  assert.equal(call(dir, 'add_feature', { agent: 'commander', name: 'lessons', title: '學習課（新）' }).json().approved, true);
  assert.equal(call(dir, 'add_feature', { agent: 'commander', name: 'lessons', waiting: 'sh waiting.sh; echo extra' }).json().approved, false);
  assert.match(brief(dir), /學習課（新）\): waiting for the founder's approval/);
  run(dir, 'addon', '--name', 'lessons', '--approve');
  run(dir, 'addon', '--name', 'lessons', '--off');
  assert.match(brief(dir), /switched off by the founder/);
  assert.match(call(dir, 'add_feature', { agent: 'commander', name: 'lessons', remove: true }).text, /removed/);
  assert.doesNotMatch(page(dir), /Your tools/);
});

test('a broken waiting check is reported, not hidden', () => {
  const dir = project();
  call(dir, 'add_feature', { ...lessons, waiting: 'echo nope >&2; exit 3' });
  run(dir, 'addon', '--name', 'lessons', '--approve');
  assert.match(brief(dir), /its waiting check failed \(nope\); fix it/);
});

test('the page approves with one tap; the guard asks before a chat approves from the shell', async () => {
  const dir = project();
  call(dir, 'add_feature', lessons);
  const port = 5400 + Math.floor(Math.random() * 400);
  const proc = spawn(process.execPath, [CLI, 'serve', '--port', String(port)], { cwd: dir, env: { ...env, WAR_ROOM_DIR: dir } });
  try {
    await until(() => spawnSync('curl', ['-s', `http://127.0.0.1:${port}/api/version`]).stdout.length > 0);
    const r = await fetch(`http://127.0.0.1:${port}/api/addon`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, body: JSON.stringify({ name: 'lessons', approve: true }) });
    assert.equal(r.status, 200);
    assert.match(brief(dir), /lessons \(學習課\): 2 waiting/);
  } finally {
    proc.kill();
  }
  const guard = spawnSync(process.execPath, [CLI, 'hook-guard'], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'war-room addon --name lessons --approve' } }), encoding: 'utf8', env: { ...env, WAR_ROOM_DIR: '/nonexistent' } }).stdout;
  assert.match(guard, /"ask"/);
});
