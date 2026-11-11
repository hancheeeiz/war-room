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

// Fake home and fake agents: no real settings, no paid calls. A fake that is started shows up in calls.txt.
const HOME = tmp('war-room-relayhome-');
const BIN = tmp('war-room-relaybin-');
for (const name of ['claude', 'codex']) {
  fs.writeFileSync(path.join(BIN, name), `#!/bin/sh\necho "${name}|$WAR_ROOM_AGENT" >> "$HOME/calls.txt"\n`);
  fs.chmodSync(path.join(BIN, name), 0o755);
}
const env = { ...process.env, HOME, WAR_ROOM_HOME: path.join(HOME, '.config', 'war-room'), PATH: `${BIN}${path.delimiter}${process.env.PATH}` };
const calls = () => { try { return fs.readFileSync(path.join(HOME, 'calls.txt'), 'utf8'); } catch { return ''; } };

const run = (dir, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env: { ...env, WAR_ROOM_DIR: dir }, encoding: 'utf8' });
const call = (dir, tool, args) => { const out = run(dir, 'call', tool, JSON.stringify(args)); return { text: out.stdout || out.stderr, json: () => JSON.parse(out.stdout) }; };
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, '.warroom', `${f}.json`), 'utf8'));

function project() {
  const dir = tmp('war-room-relay-');
  run(dir, 'init', '--project', 'video');
  call(dir, 'propose_goal', { agent: 'commander', title: 'Make the launch video', founderWords: 'make the video' });
  call(dir, 'judge_goal', { agent: 'commander', goalId: 'g1', fit: 'core', cost: 'c', risks: 'r', strongerVersion: 'none', learn: [], recommendation: 'keep', reason: 'ok' });
  call(dir, 'decide_goal', { agent: 'commander', goalId: 'g1', choice: 'keep', founderWords: 'yes' });
  call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones: [{ title: 'Video', win: 'w', checks: ['script', 'pictures', 'review'], due: '2099-12-31' }] });
  // The founder's two apps: Codex writes and reviews, Claude makes the pictures. Both are opened by hand.
  call(dir, 'hire', { agent: 'commander', name: 'writer', role: 'Script writer', use: 'app' });
  call(dir, 'hire', { agent: 'commander', name: 'maker', role: 'Picture and video maker', use: 'app' });
  call(dir, 'hire', { agent: 'commander', name: 'checker', role: 'Checks logic and pictures', use: 'app' });
  return dir;
}

// A chat standing by, as the Codex or Claude app would: one wait_for_work call over the MCP server.
function standBy(dir, agent, waitSeconds = 4) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'server/index.mjs')], { cwd: dir, env: { ...env, WAR_ROOM_DIR: dir } });
    let out = '';
    p.stdout.on('data', (d) => {
      out += d;
      const line = out.split('\n').find((l) => l.includes('"id":2'));
      if (line) { p.kill(); resolve(JSON.parse(line).result.content[0].text); }
    });
    p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
    p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'wait_for_work', arguments: { agent, waitSeconds, app: agent === 'maker' ? 'Claude app' : 'Codex app' } } })}\n`);
  });
}

test('the video relay: script → pictures → review sends back → fixed → pass, with no copying between apps', async () => {
  const dir = project();
  const t1 = call(dir, 'create_task', { agent: 'commander', goalId: 'g1', checkId: 'g1.m1.c1', title: 'Write the 30 s script', assignTo: 'writer', doneCheck: 'script.md exists' }).json();
  assert.match(t1.worker, /takes this from wait_for_work/, 'an app role is never started in the background');
  call(dir, 'create_task', { agent: 'commander', goalId: 'g1', checkId: 'g1.m1.c2', title: 'Make the pictures', assignTo: 'maker', doneCheck: 'shots/ has 5 images', after: 't1' });
  assert.match(call(dir, 'create_task', { agent: 'commander', goalId: 'g1', title: 'Self review', assignTo: 'maker', doneCheck: 'x', after: 't2', review: true }).text, /different role/);
  call(dir, 'create_task', { agent: 'commander', goalId: 'g1', checkId: 'g1.m1.c3', title: 'Check logic and pictures', assignTo: 'checker', doneCheck: 'notes', after: 't2', review: true });

  // The writer's app chat stands by and gets its task at once.
  const w1 = await standBy(dir, 'writer');
  assert.match(w1, /New task for you[\s\S]*t1 · Write the 30 s script/);
  call(dir, 'progress', { agent: 'writer', taskId: 't1', text: 'draft done, checking timing' });
  assert.equal(read(dir, 'progress').t1.text, 'draft done, checking timing');
  // The maker waits: its step is not ready until the script is checked.
  assert.match(await standBy(dir, 'maker', 1), /Nothing yet/);
  call(dir, 'report_done', { agent: 'writer', taskId: 't1', summary: 'Script written', evidence: 'cat script.md', files: ['script.md'] });
  call(dir, 'verify_task', { agent: 'commander', taskId: 't1', accepted: true, howChecked: 'read it' });

  // The maker gets the script's result in its packet: nobody copies it across.
  const m1 = await standBy(dir, 'maker');
  assert.match(m1, /What the steps before yours reported[\s\S]*t1 Write the 30 s script \(by writer, verified\): Script written\n  Files: script\.md/);
  call(dir, 'report_done', { agent: 'maker', taskId: 't2', summary: '5 shots', evidence: 'ls shots', files: ['shots/1.png', 'shots/2.png'] });

  // The review step is ready as soon as the pictures are reported, and sees them.
  const c1 = await standBy(dir, 'checker');
  assert.match(c1, /t3 · Check logic and pictures[\s\S]*Files: shots\/1\.png, shots\/2\.png[\s\S]*This is a review step/);
  assert.match(call(dir, 'report_done', { agent: 'checker', taskId: 't3', summary: 'x', evidence: 'y' }).text, /set verdict/);
  const fail = call(dir, 'report_done', { agent: 'checker', taskId: 't3', summary: 'Shot 3 shows the wrong logo; redo it', evidence: 'looked at shots', verdict: 'fail' }).json();
  assert.match(fail.next, /Sent back to maker \(t2\), round 1 of 3/);
  let tasks = read(dir, 'tasks');
  assert.equal(tasks[1].status, 'rejected');
  assert.equal(tasks[2].status, 'open');

  // Back to the maker, with exactly what to change.
  const m2 = await standBy(dir, 'maker');
  assert.match(m2, /Sent back for changes: Shot 3 shows the wrong logo/);
  call(dir, 'report_done', { agent: 'maker', taskId: 't2', summary: 'Shot 3 redone', evidence: 'ls shots', files: ['shots/3.png'] });
  const c2 = await standBy(dir, 'checker');
  assert.match(c2, /Shot 3 redone/);
  const pass = call(dir, 'report_done', { agent: 'checker', taskId: 't3', summary: 'All five shots match the script', evidence: 'looked', verdict: 'pass' }).json();
  assert.match(pass.next, /t2 counts as checked/);
  tasks = read(dir, 'tasks');
  assert.equal(tasks[1].status, 'verified');
  assert.match(tasks[1].verification.howChecked, /Reviewed by checker/);
  assert.equal(tasks[2].status, 'reported');

  // The commander, standing by in its own app, is handed the last report to check.
  const cmd = await standBy(dir, 'commander');
  assert.match(cmd, /Reports to check:[\s\S]*t3 by checker/);
  call(dir, 'verify_task', { agent: 'commander', taskId: 't3', accepted: true, howChecked: 'read the review' });
  const g = read(dir, 'goals')[0];
  assert.deepEqual(g.milestones[0].checks.map((c) => !!c.verified), [true, true, true]);
  assert.deepEqual(read(dir, 'messages').filter((m) => m.open && m.kind === 'handoff').map((m) => m.text), [], 'every report message closed itself');
  assert.equal(calls(), '', 'no background agent was ever started');
});

test('stand-by: a chat outside the team is refused; on duty, no background copy starts; messages reach the app chat', async () => {
  const dir = project();
  assert.match(await standBy(dir, 'stranger', 0), /not on the team/);
  call(dir, 'hire', { agent: 'commander', name: 'builder', role: 'Builder' });
  await standBy(dir, 'builder', 0);
  assert.ok(read(dir, 'duty').builder.lastMs);
  assert.match(call(dir, 'create_task', { agent: 'commander', goalId: 'g1', title: 'Build', assignTo: 'builder', doneCheck: 'x' }).json().worker, /on duty/);
  assert.equal(calls(), '');
  call(dir, 'post_message', { agent: 'commander', to: 'builder', kind: 'request', text: 'Use the violet logo' });
  const w = await standBy(dir, 'builder');
  assert.match(w, /Messages for you \(from other chats[\s\S]*Use the violet logo/);
  // Offered once, then not again straight away: a chat that has not closed it yet is not flooded.
  const again = await standBy(dir, 'builder', 1);
  assert.doesNotMatch(again, /violet logo/);
});

test('review safety: no pass on work that changed, no accepting a failed review, no copy of an app chat on duty', async () => {
  const dir = project();
  call(dir, 'create_task', { agent: 'commander', goalId: 'g1', title: 'Make', assignTo: 'maker', doneCheck: 'x' });
  call(dir, 'create_task', { agent: 'commander', goalId: 'g1', title: 'Review', assignTo: 'checker', doneCheck: 'x', after: 't1', review: true });
  call(dir, 'get_task_packet', { agent: 'maker' });
  call(dir, 'report_done', { agent: 'maker', taskId: 't1', summary: 'v1', evidence: 'e' });
  call(dir, 'get_task_packet', { agent: 'checker' });
  // The commander rejects v1 while the review is running; the reviewer's pass must not verify the old work.
  call(dir, 'verify_task', { agent: 'commander', taskId: 't1', accepted: false, howChecked: 'logo wrong' });
  assert.match(call(dir, 'report_done', { agent: 'checker', taskId: 't2', summary: 'looks fine', evidence: 'e', verdict: 'pass' }).json().next, /changed while you reviewed it/);
  assert.equal(read(dir, 'tasks')[0].status, 'rejected');
  assert.ok(read(dir, 'messages').some((m) => /verdict was not applied/.test(m.text)));
  // A review and the step it reviews never end up with one role.
  assert.match(call(dir, 'reassign_task', { agent: 'commander', taskId: 't2', assignTo: 'maker', reason: 'x' }).text, /different roles/);
  // An app role, or one on duty, is never started as a background copy, even by the commander.
  assert.match(call(dir, 'start_worker', { agent: 'commander', name: 'maker' }).text, /works in an app/);
  call(dir, 'hire', { agent: 'commander', name: 'builder', role: 'Builder' });
  await standBy(dir, 'builder', 0);
  assert.match(call(dir, 'start_worker', { agent: 'commander', name: 'builder' }).text, /on duty in Codex app/);
  assert.equal(calls(), '');
});

test('review rounds are capped: after three fails the commander decides', () => {
  const dir = project();
  call(dir, 'create_task', { agent: 'commander', goalId: 'g1', title: 'Make', assignTo: 'maker', doneCheck: 'x' });
  call(dir, 'create_task', { agent: 'commander', goalId: 'g1', title: 'Review', assignTo: 'checker', doneCheck: 'x', after: 't1', review: true });
  for (let i = 1; i <= 4; i += 1) {
    call(dir, 'get_task_packet', { agent: 'maker' });
    call(dir, 'report_done', { agent: 'maker', taskId: 't1', summary: `try ${i}`, evidence: 'e' });
    call(dir, 'get_task_packet', { agent: 'checker' });
    const out = call(dir, 'report_done', { agent: 'checker', taskId: 't2', summary: 'still wrong', evidence: 'e', verdict: 'fail' }).json();
    if (i < 4) assert.match(out.next, new RegExp(`round ${i} of 3`));
    else assert.match(out.next, /commander decides/);
  }
  assert.ok(read(dir, 'messages').some((m) => m.kind === 'conflict' && /failed t1 \(Make\) 3 times/.test(m.text)));
  assert.match(call(dir, 'verify_task', { agent: 'commander', taskId: 't2', accepted: true, howChecked: 'ok' }).text, /review that failed/);
});
