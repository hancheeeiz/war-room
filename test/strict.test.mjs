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

// Fake home and a fake claude that only records how it was started: no real settings, no paid calls.
const HOME = tmp('war-room-stricthome-');
const BIN = tmp('war-room-strictbin-');
fs.writeFileSync(path.join(BIN, 'claude'), '#!/bin/sh\necho "$WAR_ROOM_AGENT|$*" >> "$HOME/claude-calls.txt"\n');
fs.chmodSync(path.join(BIN, 'claude'), 0o755);
const env = { ...process.env, HOME, WAR_ROOM_HOME: path.join(HOME, '.config', 'war-room'), PATH: `${BIN}${path.delimiter}${process.env.PATH}` };
const calls = () => { try { return fs.readFileSync(path.join(HOME, 'claude-calls.txt'), 'utf8'); } catch { return ''; } };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } throw new Error('timed out'); };

const pad = (n) => String(n).padStart(2, '0');
const day = (offset = 0) => { const d = new Date(Date.now() + offset * 86400e3); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

function project() {
  const dir = tmp('war-room-strict-');
  spawnSync(process.execPath, [CLI, 'init', '--project', 'demo'], { cwd: dir, env });
  return dir;
}
const run = (dir, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env: { ...env, WAR_ROOM_DIR: dir }, encoding: 'utf8' });
const call = (dir, tool, args) => {
  const out = run(dir, 'call', tool, JSON.stringify(args));
  return { ok: out.status === 0, text: out.stdout || out.stderr, json: () => JSON.parse(out.stdout) };
};
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, '.warroom', `${f}.json`), 'utf8'));
const write = (dir, f, v) => fs.writeFileSync(path.join(dir, '.warroom', `${f}.json`), JSON.stringify(v, null, 2));

function approved(dir, byWhen) {
  call(dir, 'propose_goal', { agent: 'commander', title: 'Ship the site', founderWords: 'ship it', ...(byWhen ? { byWhen } : {}) });
  call(dir, 'judge_goal', { agent: 'commander', goalId: 'g1', fit: 'core', cost: 'a day', risks: 'none', strongerVersion: 'none', learn: [], recommendation: 'keep', reason: 'ok' });
  call(dir, 'decide_goal', { agent: 'commander', goalId: 'g1', choice: 'keep', founderWords: 'yes' });
}

test('dates: every milestone needs a due date; start after due and a plan past the deadline are caught', () => {
  const dir = project();
  approved(dir, 'live by 2030-06-30');
  const plan = (milestones) => call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones });
  assert.match(plan([{ title: 'Build', win: 'w', checks: ['c'] }]).text, /needs a due date as YYYY-MM-DD.*live by 2030-06-30/);
  assert.match(plan([{ title: 'Build', win: 'w', checks: ['c'], due: 'next week' }]).text, /needs a due date/);
  assert.match(plan([{ title: 'Build', win: 'w', checks: ['c'], start: '2030-02-01', due: '2030-01-01' }]).text, /starts after it is due/);
  const late = plan([{ title: 'Build', win: 'w', checks: ['c'], due: '2030-07-15' }]).json();
  assert.match(late.warning, /after the goal's deadline 2030-06-30/);
  const ok = plan([{ title: 'Build', win: 'w', checks: ['c'], start: '2030-01-01', due: '2030-02-01' }]).json();
  assert.equal(ok.milestones[0].due, '2030-02-01');
  assert.equal(ok.warning, undefined);
  assert.match(ok.next, /hand them to your team; do not do them yourself/);
});

test('behind schedule: a milestone past its due day shows in status, the brief and on the page', () => {
  const dir = project();
  approved(dir);
  call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones: [{ title: 'Late one', win: 'w', checks: ['c'], due: day(-2) }, { title: 'On time', win: 'w', checks: ['d'], due: day(5) }] });
  const ms = call(dir, 'war_room_status', {}).json().goals[0].milestones;
  assert.deepEqual(ms.map((m) => m.overdue), [true, false]);
  assert.match(call(dir, 'war_room_brief', { agent: 'commander' }).text, /## Behind schedule[\s\S]*g1\.m1 Late one: due/);
  const html = fs.readFileSync(run(dir, 'dashboard').stdout.trim(), 'utf8');
  assert.match(html, /⚠ Behind · was due/);
  assert.match(html, /Due \d+ \w+/);
});

test('a plan saved before dates were required is flagged until it is re-planned', () => {
  const dir = project();
  approved(dir);
  call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones: [{ title: 'A', win: 'w', checks: ['c'], due: day(3) }] });
  const goals = read(dir, 'goals');
  delete goals[0].milestones[0].due;
  write(dir, 'goals', goals);
  assert.match(call(dir, 'war_room_brief', { agent: 'commander' }).text, /## Plans without dates/);
  assert.match(fs.readFileSync(run(dir, 'dashboard').stdout.trim(), 'utf8'), /No date set/);
});

test('today makes itself: unfinished items carry over and the next checks fill the list', () => {
  const dir = project();
  approved(dir);
  call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones: [{ title: 'A', win: 'w', checks: ['a1', 'a2', 'a3', 'a4'], due: day(9) }] });
  // Yesterday: the founder did one thing and left another.
  const goals = read(dir, 'goals');
  goals[0].daily = { [day(-1)]: [{ text: 'call the printer', done: true }, { text: 'write the welcome copy', at: '09:30' }] };
  write(dir, 'goals', goals);
  const t = call(dir, 'war_room_status', {}).json().goals[0].today;
  assert.deepEqual(t.map((i) => i.text), ['write the welcome copy', 'a1', 'a2']);
  assert.equal(t[0].carried, true);
  assert.equal(t[0].at, '09:30');
  assert.match(call(dir, 'war_room_brief', { agent: 'commander' }).text, /## Today[\s\S]*made by the war room from the plan[\s\S]*09:30 write the welcome copy · carried over/);
  const html = fs.readFileSync(run(dir, 'dashboard').stdout.trim(), 'utf8');
  assert.match(html, /Made by the war room from your plan/);
  assert.match(html, /from yesterday/);
  // The commander can still replace it, with times; a bad time is refused.
  assert.match(call(dir, 'set_today', { agent: 'commander', goalId: 'g1', items: [{ text: 'x', at: '9am' }] }).text, /like 09:30/);
  call(dir, 'set_today', { agent: 'commander', goalId: 'g1', items: [{ text: 'Read the pricing note', at: '20:00' }] });
  assert.equal(read(dir, 'goals')[0].dailyAuto[day()], undefined);
  assert.doesNotMatch(call(dir, 'war_room_brief', { agent: 'commander' }).text, /made by the war room/);
});

test('today links its items to the task for that check, so they tick themselves', () => {
  const dir = project();
  approved(dir);
  call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones: [{ title: 'A', win: 'w', checks: ['page builds'], due: day(9) }] });
  call(dir, 'create_task', { agent: 'commander', goalId: 'g1', checkId: 'g1.m1.c1', title: 'Build page', assignTo: 'builder', doneCheck: 'npm run build' });
  const goals = read(dir, 'goals');
  delete goals[0].daily;
  write(dir, 'goals', goals);
  assert.equal(call(dir, 'war_room_status', {}).json().goals[0].today[0].taskId, 't1');
});

test('the commander never does the work: no tasks to itself, none handed back to it', () => {
  const dir = project();
  approved(dir);
  call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones: [{ title: 'A', win: 'w', checks: ['c'], due: day(9) }] });
  assert.match(call(dir, 'create_task', { agent: 'commander', goalId: 'g1', title: 'Do it myself', assignTo: 'commander', doneCheck: 'x' }).text, /does not take tasks/);
  call(dir, 'create_task', { agent: 'commander', goalId: 'g1', title: 'Build', assignTo: 'builder', doneCheck: 'x' });
  assert.match(call(dir, 'reassign_task', { agent: 'commander', taskId: 't1', assignTo: 'commander', reason: 'quicker' }).text, /does not take tasks/);
  // A task still on the commander from an older war room is called out in its brief.
  const tasks = read(dir, 'tasks');
  tasks.push({ id: 't9', goalId: 'g1', title: 'Old self task', agent: 'commander', status: 'open', files: [], rules: [], tags: [] });
  write(dir, 'tasks', tasks);
  assert.match(call(dir, 'war_room_brief', { agent: 'commander' }).text, /## Tasks still assigned to you, the commander[\s\S]*t9 Old self task/);
});

test('work starts by itself: a task for a hired role starts its chat; open work with nobody on it is called out', async () => {
  const dir = project();
  approved(dir);
  call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones: [{ title: 'A', win: 'w', checks: ['c', 'd'], due: day(9) }] });
  call(dir, 'hire', { agent: 'commander', name: 'designer', role: 'Screen designer', model: 'sonnet' });
  const hired = call(dir, 'create_task', { agent: 'commander', goalId: 'g1', checkId: 'g1.m1.c1', title: 'Draw home', assignTo: 'designer', doneCheck: 'png' }).json();
  assert.match(hired.worker, /Started designer/);
  await until(() => /^designer\|.*--model sonnet/m.test(calls()));
  const loose = call(dir, 'create_task', { agent: 'commander', goalId: 'g1', checkId: 'g1.m1.c2', title: 'Wire API', assignTo: 'backend', doneCheck: 'curl' }).json();
  assert.match(loose.worker, /not on the team/);
  assert.match(call(dir, 'war_room_brief', { agent: 'commander' }).text, /## Open work with nobody on it[\s\S]*backend: t2/);
});

test('a report needs the task taken first: one chat cannot report work under several names', () => {
  const dir = project();
  approved(dir);
  call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones: [{ title: 'A', win: 'w', checks: ['c'], due: day(9) }] });
  call(dir, 'create_task', { agent: 'commander', goalId: 'g1', title: 'Build', assignTo: 'mobile', doneCheck: 'x' });
  assert.match(call(dir, 'report_done', { agent: 'mobile', taskId: 't1', summary: 's', evidence: 'e' }).text, /Take it with get_task_packet first/);
  call(dir, 'get_task_packet', { agent: 'mobile' });
  assert.equal(call(dir, 'report_done', { agent: 'mobile', taskId: 't1', summary: 's', evidence: 'e' }).json().ok, true);
});

test('long-term memory: the commander starts every chat with the founder\'s decisions and preferences', () => {
  const dir = project();
  call(dir, 'remember', { agent: 'commander', kind: 'decision', text: '2026-11-08 founder: keep the free tier with three matches a day' });
  call(dir, 'remember', { agent: 'commander', kind: 'pref', text: 'Founder wants replies in Cantonese, plain words' });
  call(dir, 'remember', { agent: 'commander', kind: 'problem', text: 'The build server timed out twice' });
  const b = call(dir, 'war_room_brief', { agent: 'commander' }).text;
  assert.match(b, /## What the founder decided and prefers[\s\S]*three matches a day[\s\S]*/);
  assert.match(b, /Cantonese/);
  assert.doesNotMatch(b.split('## What the founder decided')[1].split('\n## ')[0], /build server/);
});

test('daily check: makes today\'s list and leaves one plain summary in the commander\'s inbox', () => {
  const dir = project();
  approved(dir);
  call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones: [{ title: 'Late', win: 'w', checks: ['c'], due: day(-1) }] });
  call(dir, 'create_task', { agent: 'commander', goalId: 'g1', title: 'Build', assignTo: 'backend', doneCheck: 'x' });
  call(dir, 'ask_founder', { agent: 'commander', question: 'Which banner colour for launch?', suggested: 'violet' });
  const out = run(dir, 'daily').stdout;
  assert.match(out, /Daily check .*today 0\/1 .*Behind: Late, due .*1 question\(s\) waiting on the founder.*nobody running: backend/);
  const inbox = read(dir, 'messages').filter((m) => m.from === 'war-room');
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].to, 'commander');
  assert.ok(read(dir, 'goals')[0].daily[day()].length);
});

test('reading the war room does not rewrite it: the page and watcher can redraw without looping', () => {
  const dir = project();
  approved(dir);
  call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones: [{ title: 'A', win: 'w', checks: ['c'], due: day(9) }] });
  call(dir, 'war_room_status', {});
  const f = path.join(dir, '.warroom', 'goals.json');
  const before = fs.statSync(f).mtimeMs;
  run(dir, 'dashboard');
  call(dir, 'war_room_brief', { agent: 'commander' });
  call(dir, 'war_room_status', {});
  assert.equal(fs.statSync(f).mtimeMs, before);
  // Same when every check is done and today's list is empty.
  const goals = read(dir, 'goals');
  goals[0].milestones[0].checks[0].verified = true;
  delete goals[0].daily;
  write(dir, 'goals', goals);
  call(dir, 'war_room_status', {});
  const after = fs.statSync(f).mtimeMs;
  run(dir, 'dashboard');
  call(dir, 'war_room_status', {});
  assert.equal(fs.statSync(f).mtimeMs, after);
});

test('an item whose check got verified does not carry over to the next day', () => {
  const dir = project();
  approved(dir);
  call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones: [{ title: 'A', win: 'w', checks: ['a1', 'a2'], due: day(9) }] });
  const goals = read(dir, 'goals');
  goals[0].daily = { [day(-1)]: [{ text: 'a1', checkId: 'g1.m1.c1' }] };
  goals[0].milestones[0].checks[0].verified = true;
  write(dir, 'goals', goals);
  assert.deepEqual(call(dir, 'war_room_status', {}).json().goals[0].today.map((i) => i.text), ['a2']);
});

test('daily check stays quiet when nothing is planned', () => {
  const dir = project();
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', `import { Store } from ${JSON.stringify(path.join(ROOT, 'server/store.mjs'))}; import { dailyCheck } from ${JSON.stringify(path.join(ROOT, 'server/tools.mjs'))}; console.log(String(dailyCheck(new Store())));`], { cwd: dir, env: { ...env, WAR_ROOM_DIR: dir }, encoding: 'utf8' });
  assert.equal(out.stdout.trim(), 'null', out.stderr);
});
