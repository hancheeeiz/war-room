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

// Fake home and a fake claude that only records how it was started: no real settings, no paid calls.
const HOME = tmp('war-room-teamhome-');
const BIN = tmp('war-room-teambin-');
fs.writeFileSync(path.join(BIN, 'claude'), '#!/bin/sh\necho "$WAR_ROOM_AGENT|$*" >> "$HOME/claude-calls.txt"\n');
fs.chmodSync(path.join(BIN, 'claude'), 0o755);
const env = { ...process.env, HOME, WAR_ROOM_HOME: path.join(HOME, '.config', 'war-room'), PATH: `${BIN}${path.delimiter}${process.env.PATH}` };
const calls = () => { try { return fs.readFileSync(path.join(HOME, 'claude-calls.txt'), 'utf8'); } catch { return ''; } };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } throw new Error('timed out'); };

function project() {
  const dir = tmp('war-room-team-');
  spawnSync(process.execPath, [CLI, 'init', '--project', 'demo'], { cwd: dir, env });
  return dir;
}
const call = (dir, tool, args) => {
  const out = spawnSync(process.execPath, [CLI, 'call', tool, JSON.stringify(args)], { cwd: dir, env: { ...env, WAR_ROOM_DIR: dir }, encoding: 'utf8' });
  return { ok: out.status === 0, text: out.stdout || out.stderr, json: () => JSON.parse(out.stdout) };
};

function activeGoal(dir) {
  call(dir, 'propose_goal', { agent: 'commander', title: 'Ship the site', founderWords: 'ship it' });
  call(dir, 'judge_goal', { agent: 'commander', goalId: 'g1', fit: 'core', cost: 'a day', risks: 'none', strongerVersion: 'none', learn: [], recommendation: 'keep', reason: 'ok' });
  call(dir, 'decide_goal', { agent: 'commander', goalId: 'g1', choice: 'keep', founderWords: 'yes' });
  call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones: [{ title: 'Build', win: 'live', checks: ['page builds', 'page reviewed'] }] });
}

test('memory: unrelated facts saved the same minute are not flagged as conflicts; a real overlap still is', () => {
  const dir = project();
  assert.equal(call(dir, 'remember', { agent: 'commander', kind: 'fact', text: '2026-11-06 14:02 founder: the website runs on Next.js hosted at Vercel' }).json().stored, true);
  const second = call(dir, 'remember', { agent: 'commander', kind: 'fact', text: '2026-11-06 14:02 founder: the Discord admin is a friend called Sam' }).json();
  assert.equal(second.stored, true, 'unrelated fact with the same timestamp must be stored');
  const clash = call(dir, 'remember', { agent: 'commander', kind: 'decision', text: 'The website runs on Next.js hosted at Netlify now' }).json();
  assert.equal(clash.stored, false);
  assert.match(clash.askFounder, /Vercel/);
});

test('team: only the commander hires; roles show in the brief and on the page', () => {
  const dir = project();
  assert.match(call(dir, 'hire', { agent: 'designer', name: 'designer', role: 'Screen designer' }).text, /Only the commander/);
  assert.match(call(dir, 'hire', { agent: 'commander', name: 'designer' }).text, /needs a role/);
  call(dir, 'hire', { agent: 'commander', name: 'designer', role: 'Screen designer', does: 'Makes the screens', model: 'sonnet' });
  call(dir, 'hire', { agent: 'commander', name: 'reviewer', role: 'Reviewer', use: 'codex' });
  assert.match(call(dir, 'war_room_brief', { agent: 'commander' }).text, /designer: Screen designer — Makes the screens \(claude sonnet\)/);
  assert.match(call(dir, 'war_room_brief', { agent: 'designer' }).text, /Your role: Screen designer/);
  const html = fs.readFileSync(spawnSync(process.execPath, [CLI, 'dashboard'], { cwd: dir, env: { ...env, WAR_ROOM_DIR: dir }, encoding: 'utf8' }).stdout.trim(), 'utf8');
  assert.match(html, /Screen designer/);
  assert.match(html, /OpenAI/);
  assert.match(html, /data-to="reviewer"/);
  assert.match(html, /Tell the commander/);
  call(dir, 'hire', { agent: 'commander', name: 'reviewer', remove: true });
  assert.doesNotMatch(call(dir, 'war_room_brief', { agent: 'commander' }).text, /reviewer: Reviewer/);
});

test('step by step: a task waits for the one before it, and its worker starts by itself once that is verified', async () => {
  const dir = project();
  activeGoal(dir);
  call(dir, 'hire', { agent: 'commander', name: 'builder', role: 'Builder', model: 'sonnet' });
  call(dir, 'hire', { agent: 'commander', name: 'reviewer', role: 'Reviewer', model: 'haiku' });
  call(dir, 'create_task', { agent: 'commander', goalId: 'g1', checkId: 'g1.m1.c1', title: 'Build page', assignTo: 'builder', doneCheck: 'npm run build' });
  assert.match(call(dir, 'create_task', { agent: 'commander', goalId: 'g1', title: 'x', assignTo: 'reviewer', doneCheck: 'y', after: 't9' }).text, /No task t9/);
  call(dir, 'create_task', { agent: 'commander', goalId: 'g1', checkId: 'g1.m1.c2', title: 'Review page', assignTo: 'reviewer', doneCheck: 'review notes', after: 't1' });
  assert.match(call(dir, 'get_task_packet', { agent: 'reviewer' }).text, /waits for t1/);
  assert.match(call(dir, 'get_task_packet', { agent: 'builder' }).text, /Build page/);
  call(dir, 'report_done', { agent: 'builder', taskId: 't1', summary: 'built', evidence: 'build ok' });
  call(dir, 'verify_task', { agent: 'commander', taskId: 't1', accepted: true, howChecked: 'ran the build' });
  // The reviewer starts on its own, with the model the commander set for that role.
  await until(() => /^reviewer\|.*--model haiku/m.test(calls()));
  assert.match(call(dir, 'get_task_packet', { agent: 'reviewer' }).text, /Review page/);
});

test('page box: the founder\'s words wake a background commander; a message to one member wakes that member', async () => {
  const dir = project();
  call(dir, 'hire', { agent: 'commander', name: 'designer', role: 'Screen designer' });
  const port = 4900 + Math.floor(Math.random() * 500);
  const proc = spawn(process.execPath, [CLI, 'serve', '--port', String(port)], { cwd: dir, env: { ...env, WAR_ROOM_DIR: dir } });
  try {
    await until(() => { try { return spawnSync('curl', ['-s', `http://127.0.0.1:${port}/api/version`]).stdout.length > 0; } catch { return false; } });
    const say = (body) => fetch(`http://127.0.0.1:${port}/api/say`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    assert.equal((await say({ text: 'Make the landing page calmer' })).status, 200);
    await until(() => /^commander\|.*read_messages/m.test(calls()));
    const msgs = JSON.parse(fs.readFileSync(path.join(dir, '.warroom/messages.json'), 'utf8'));
    assert.ok(msgs.some((m) => m.to === 'commander' && /calmer/.test(m.text)));
    assert.equal((await say({ text: 'use bigger buttons', to: 'designer' })).status, 200);
    await until(() => /^designer\|.*founder sent you a message/m.test(calls()));
    assert.equal((await say({ text: 'hi', to: 'nobody' })).status, 400);
  } finally {
    proc.kill();
  }
});
