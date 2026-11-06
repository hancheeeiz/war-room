import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { markdownToHtml } from '../server/shelf.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.WAR_ROOM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'war-room-home-'));
const CLI = path.join(ROOT, 'bin/war-room.mjs');

const NOTE = `# 學習筆記一：事件溯源與種子隨機

**為什麼先學這兩樣**：底層法則有兩條要在程式裡成立。
- **因果帳只能新增，不能刪改**。
- 同一個種子，同一個世界。
  - 可以重播

## 三個詞
| 詞 | 意思 |
|---|---|
| **事件** | 一件已經發生、不能改的事 |

1. **JavaScript 內建的 \`Math.random()\` 不能設種子。** 所以要自己帶一個。

\`\`\`ts
const 加入 = (帳, e) => [...帳, e]; // <b>not bold</b>
\`\`\`

<script>alert("x")</script>
`;

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'war-room-shelf-'));
  spawnSync(process.execPath, [CLI, 'init', '--project', 'demo', '--commander', 'commander'], { cwd: dir });
  fs.mkdirSync(path.join(dir, 'docs/學習'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/學習/01-事件溯源.md'), NOTE);
  return dir;
}

const call = (dir, name, args) => {
  const r = spawnSync(process.execPath, [CLI, 'call', name, JSON.stringify(args)], { cwd: dir, encoding: 'utf8', env: { ...process.env, WAR_ROOM_DIR: dir } });
  return { error: r.status ? r.stderr.trim() : null, json: r.status ? null : (() => { try { return JSON.parse(r.stdout); } catch { return null; } })() };
};
const shelfFile = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.warroom/shelf.json'), 'utf8'));
const page = (dir) => fs.readFileSync(spawnSync(process.execPath, [CLI, 'dashboard'], { cwd: dir, encoding: 'utf8' }).stdout.trim(), 'utf8');

test('shelve: a project note goes on the shelf, by pointer, and comes off again', () => {
  const dir = tmpProject();
  const put = call(dir, 'shelve', { agent: 'commander', path: 'docs/學習/01-事件溯源.md' });
  assert.equal(put.error, null);
  assert.equal(put.json.shelved.title, '學習筆記一：事件溯源與種子隨機', 'title defaults to the first heading');
  assert.equal(put.json.shelved.category, '學習', 'category defaults to the folder name');
  assert.match(put.json.shelved.added, /^\d{4}-\d{2}-\d{2} /);
  const [item] = shelfFile(dir);
  assert.deepEqual(Object.keys(item).sort(), ['added', 'by', 'category', 'id', 'path', 'title']);
  assert.ok(!JSON.stringify(item).includes('因果帳只能新增'), 'the shelf keeps a pointer, never a copy of the text');
  // Shelving it again updates the entry instead of adding a second one.
  call(dir, 'shelve', { agent: 'commander', path: './docs/學習/01-事件溯源.md', category: '法則', title: '筆記一' });
  assert.equal(shelfFile(dir).length, 1);
  assert.equal(shelfFile(dir)[0].category, '法則');
  assert.match(call(dir, 'shelve', { agent: 'worker', path: 'docs/學習/01-事件溯源.md' }).error, /Only the commander/);
  // Off the shelf by path or by id; the file itself stays.
  assert.equal(call(dir, 'shelve', { agent: 'commander', path: 'docs/學習/01-事件溯源.md', remove: true }).json.removed.id, 'b1');
  assert.deepEqual(shelfFile(dir), []);
  const again = call(dir, 'shelve', { agent: 'commander', path: 'docs/學習/01-事件溯源.md' }).json.shelved;
  assert.equal(call(dir, 'shelve', { agent: 'commander', path: again.id, remove: true }).json.removed.path, 'docs/學習/01-事件溯源.md');
  assert.ok(fs.existsSync(path.join(dir, 'docs/學習/01-事件溯源.md')));
  assert.match(call(dir, 'shelve', { agent: 'commander', path: 'docs/none.md', remove: true }).error, /not on the shelf/);
});

test('shelve refuses anything outside the project, and the page re-checks a planted shelf', () => {
  const dir = tmpProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'war-room-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.md'), '# outside secret text');
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(dir, 'docs/link.md'));
  fs.writeFileSync(path.join(dir, '.env'), 'KEY=1');
  for (const p of [`../${path.basename(outside)}/secret.md`, path.join(outside, 'secret.md'), 'docs/link.md', '../../../../../../etc/hosts']) {
    assert.match(call(dir, 'shelve', { agent: 'commander', path: p }).error, /inside this project|Only Markdown/, p);
  }
  assert.match(call(dir, 'shelve', { agent: 'commander', path: '.env' }).error, /Only Markdown/);
  assert.match(call(dir, 'shelve', { agent: 'commander', path: '.warroom/notes.md' }).error, /No such file|War-room files/);
  assert.match(call(dir, 'shelve', { agent: 'commander', path: 'docs/missing.md' }).error, /No such file/);
  assert.deepEqual(shelfFile(dir), [], 'nothing refused was stored');
  // A shelf.json copied in from elsewhere cannot make the page show files outside the project.
  fs.writeFileSync(path.join(dir, '.warroom/shelf.json'), JSON.stringify([
    { id: 'b1', title: 'Planted', path: path.join(outside, 'secret.md'), category: 'x', added: '2026-01-01 00:00' },
    { id: 'b2', title: 'Planted link', path: 'docs/link.md', category: 'x', added: '2026-01-01 00:00' },
  ]));
  const html = page(dir);
  assert.match(html, /Planted/);
  assert.ok(!html.includes('outside secret text'), 'the page must not read outside the project');
  assert.match(html, /Cannot show this file: Only files inside this project/);
});

test('page: the shelf tab lists the note and shows it as a readable page', () => {
  const dir = tmpProject();
  call(dir, 'shelve', { agent: 'commander', path: 'docs/學習/01-事件溯源.md' });
  const html = page(dir);
  assert.match(html, /data-go="shelf">Shelf <span class="tab-n">1<\/span><\/button>/);
  assert.match(html, /<h2>學習<\/h2>[\s\S]*data-book="b1"[\s\S]*學習筆記一：事件溯源與種子隨機/);
  const book = html.slice(html.indexOf('id="book-b1"'), html.indexOf('</article>', html.indexOf('id="book-b1"')));
  assert.match(book, /<h1>學習筆記一：事件溯源與種子隨機<\/h1>/);
  assert.match(book, /<table><thead><tr><th>詞<\/th><th>意思<\/th><\/tr><\/thead><tbody><tr><td><strong>事件<\/strong><\/td>/);
  assert.match(book, /<li><strong>JavaScript 內建的 <code>Math.random\(\)<\/code> 不能設種子。<\/strong>/, 'bold around a code span');
  assert.match(book, /<li><strong>因果帳只能新增，不能刪改<\/strong>。<\/li><li>同一個種子，同一個世界。<ul><li>可以重播<\/li><\/ul><\/li>/, 'nested list');
  assert.match(book, /<pre><code data-lang="ts">const 加入 = \(帳, e\) =&gt; \[\.\.\.帳, e\]; \/\/ &lt;b&gt;not bold&lt;\/b&gt;<\/code><\/pre>/);
  assert.ok(!book.includes('<script>'), 'HTML in the file is shown as text, never run');
  assert.match(book, /&lt;script&gt;/);
  assert.ok(!/<script[^>]+src=|<link[^>]+href=["']?https?:|@import|url\(\s*["']?https?:/i.test(html), 'the page loads nothing from other sites');
  // Edited file → the page shows the new text; there is no stale copy.
  fs.appendFileSync(path.join(dir, 'docs/學習/01-事件溯源.md'), '\n## 新加的一節\n');
  assert.match(page(dir), /<h2>新加的一節<\/h2>/);
});

test('markdown: escapes, links and the odd cases', () => {
  assert.equal(markdownToHtml('a <img src=x onerror=alert(1)> b'), '<p>a &lt;img src=x onerror=alert(1)&gt; b</p>');
  assert.equal(markdownToHtml('[x](javascript:alert(1))'), '<p><span class="md-link" title="javascript:alert(1">x</span>)</p>');
  assert.match(markdownToHtml('[site](https://a.example/?q=1&b=2)'), /<a href="https:\/\/a\.example\/\?q=1&amp;b=2" target="_blank" rel="noopener noreferrer">site<\/a>/);
  assert.equal(markdownToHtml('![pic](https://a.example/p.png)'), '<p>pic</p>', 'images are never loaded');
  assert.equal(markdownToHtml('| a | b |\n|:-|-:|\n| `x|y` | \\| |'), '<div class="md-table"><table><thead><tr><th>a</th><th style="text-align:right">b</th></tr></thead><tbody><tr><td><code>x|y</code></td><td style="text-align:right">|</td></tr></tbody></table></div>');
  assert.equal(markdownToHtml('3. c\n4. d'), '<ol start="3"><li>c</li><li>d</li></ol>');
  assert.equal(markdownToHtml('> 引言 *斜*'), '<blockquote><p>引言 <em>斜</em></p></blockquote>');
  assert.equal(markdownToHtml('第一行\n第二行'), '<p>第一行<br>第二行</p>');
  assert.equal(markdownToHtml('## C#\n---'), '<h2>C#</h2>\n<hr>');
});

test('serve: the shelf is on the live page with the security headers kept', async (tc) => {
  const dir = tmpProject();
  call(dir, 'shelve', { agent: 'commander', path: 'docs/學習/01-事件溯源.md' });
  const port = 45000 + Math.floor(Math.random() * 900);
  const srv = spawn(process.execPath, [CLI, 'serve', '--port', String(port)], { cwd: dir, env: { ...process.env, WAR_ROOM_DIR: dir } });
  tc.after(() => srv.kill());
  await new Promise((r) => srv.stdout.once('data', r));
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'; script-src 'unsafe-inline'/);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(await res.text(), /<h1>學習筆記一：事件溯源與種子隨機<\/h1>/);
});

// A plan reordered or edited later must keep ids unique and in place, keep verified checks verified,
// and keep tasks pointing at the right check.
test('set_plan renumbers checks by their new place and keeps only verified state and evidence', () => {
  const dir = tmpProject();
  call(dir, 'propose_goal', { agent: 'commander', title: 'G', founderWords: 'g', what: 'x', forWhom: 'x', byWhen: 'x', doneLooksLike: 'x', mustNever: 'x' });
  call(dir, 'judge_goal', { agent: 'commander', goalId: 'g1', fit: 'x', cost: 'x', risks: 'x', strongerVersion: 'none', learn: [], recommendation: 'keep', reason: 'x' });
  call(dir, 'decide_goal', { agent: 'commander', goalId: 'g1', choice: 'keep', founderWords: 'ok' });
  call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones: [{ title: 'A', win: 'w', checks: ['a1', 'a2'] }, { title: 'B', win: 'w', checks: ['b1', 'b2'] }] });
  call(dir, 'create_task', { agent: 'commander', goalId: 'g1', checkId: 'g1.m1.c2', title: 'do a2', assignTo: 'w1', doneCheck: 'x' });
  call(dir, 'create_task', { agent: 'commander', goalId: 'g1', checkId: 'g1.m2.c1', title: 'do b1', assignTo: 'w2', doneCheck: 'x' });
  call(dir, 'create_task', { agent: 'commander', goalId: 'g1', checkId: 'g1.m1.c1', title: 'do a1', assignTo: 'w3', doneCheck: 'x' });
  call(dir, 'get_task_packet', { agent: 'w1' });
  call(dir, 'report_done', { agent: 'w1', taskId: 't1', summary: 's', evidence: 'e' });
  call(dir, 'verify_task', { agent: 'commander', taskId: 't1', accepted: true, howChecked: 'ran it myself' });
  // New milestone first, B's checks reordered, a1 dropped.
  const g = call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones: [{ title: 'New', win: 'w', checks: ['n1'] }, { title: 'A', win: 'w', checks: ['a2'] }, { title: 'B', win: 'w', checks: ['b2', 'b1'] }] }).json;
  const checks = g.milestones.flatMap((m) => m.checks);
  assert.deepEqual(checks.map((c) => c.id), ['g1.m1.c1', 'g1.m2.c1', 'g1.m3.c1', 'g1.m3.c2']);
  assert.deepEqual(checks.map((c) => c.text), ['n1', 'a2', 'b2', 'b1']);
  assert.equal(checks[1].verified, true);
  assert.equal(checks[1].evidence, 'ran it myself');
  assert.ok(checks[1].verifiedAt);
  assert.ok(checks.filter((c) => c !== checks[1]).every((c) => c.verified === false && !c.evidence));
  const tasks = JSON.parse(fs.readFileSync(path.join(dir, '.warroom/tasks.json'), 'utf8'));
  assert.equal(tasks.find((t) => t.id === 't1').checkId, 'g1.m2.c1');
  assert.equal(tasks.find((t) => t.id === 't2').checkId, 'g1.m3.c2', 'the task follows its check to the new id');
  const t3 = tasks.find((t) => t.id === 't3');
  assert.equal(t3.checkId, undefined, 'a task whose check left the plan no longer ticks another check');
  assert.equal(t3.droppedCheck, 'g1.m1.c1');
});

test('today: the founder ticks a goal with no task; task-linked goals tick themselves', async (tc) => {
  const dir = tmpProject();
  call(dir, 'propose_goal', { agent: 'commander', title: 'G', founderWords: 'g', what: 'x', forWhom: 'x', byWhen: 'x', doneLooksLike: 'x', mustNever: 'x' });
  call(dir, 'judge_goal', { agent: 'commander', goalId: 'g1', fit: 'x', cost: 'x', risks: 'x', strongerVersion: 'none', learn: [], recommendation: 'keep', reason: 'x' });
  call(dir, 'decide_goal', { agent: 'commander', goalId: 'g1', choice: 'keep', founderWords: 'ok' });
  call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones: [{ title: 'A', win: 'w', checks: ['a1'] }] });
  call(dir, 'create_task', { agent: 'commander', goalId: 'g1', title: 'T', assignTo: 'w1', doneCheck: 'x' });
  call(dir, 'set_today', { agent: 'commander', goalId: 'g1', items: [{ text: '你：讀筆記一' }, { text: '寫程式', taskId: 't1' }] });
  assert.match(page(dir), /data-tick="0" data-goal="g1" data-text="你：讀筆記一" data-done="0"/);
  assert.ok(!page(dir).includes('data-tick="1"'), 'a task-linked goal has no tick box');
  const port = 44000 + Math.floor(Math.random() * 900);
  const srv = spawn(process.execPath, [CLI, 'serve', '--port', String(port)], { cwd: dir, env: { ...process.env, WAR_ROOM_DIR: dir } });
  tc.after(() => srv.kill());
  await new Promise((r) => srv.stdout.once('data', r));
  const tick = (body) => fetch(`http://127.0.0.1:${port}/api/today`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  assert.equal((await tick({ goalId: 'g1', index: 0, text: '你：讀筆記一', done: true })).status, 200);
  assert.match((await tick({ goalId: 'g1', index: 1, text: '寫程式', done: true })).body.error, /ticks itself when task t1/);
  assert.match((await tick({ goalId: 'g1', index: 0, text: 'something else', done: true })).body.error, /list changed/);
  let status = JSON.parse(spawnSync(process.execPath, [CLI, 'call', 'war_room_status'], { cwd: dir, encoding: 'utf8' }).stdout);
  assert.deepEqual(status.goals[0].today.map((t) => t.done), [true, false]);
  // Setting the list again keeps the founder's tick; the terminal can untick.
  call(dir, 'set_today', { agent: 'commander', goalId: 'g1', items: [{ text: '你：讀筆記一' }, { text: '寫程式', taskId: 't1' }] });
  status = JSON.parse(spawnSync(process.execPath, [CLI, 'call', 'war_room_status'], { cwd: dir, encoding: 'utf8' }).stdout);
  assert.equal(status.goals[0].today[0].done, true);
  assert.match(spawnSync(process.execPath, [CLI, 'tick', '--item', '1', '--undo'], { cwd: dir, encoding: 'utf8' }).stdout, /\[ \] 你：讀筆記一/);
});

function judged(dir, learn) {
  call(dir, 'propose_goal', { agent: 'commander', title: 'G', founderWords: 'g', what: 'x', forWhom: 'x', byWhen: 'x', doneLooksLike: 'x', mustNever: 'x' });
  call(dir, 'judge_goal', { agent: 'commander', goalId: 'g1', fit: 'x', cost: 'x', risks: 'x', strongerVersion: 'none', learn, recommendation: 'keep', reason: 'x' });
  call(dir, 'decide_goal', { agent: 'commander', goalId: 'g1', choice: 'keep', founderWords: 'ok' });
}
const brief = (dir) => spawnSync(process.execPath, [CLI, 'call', 'war_room_brief', '{"agent":"commander"}'], { cwd: dir, encoding: 'utf8', env: { ...process.env, WAR_ROOM_DIR: dir } }).stdout;

test('learning depends on the goal: topics become notes to write; a goal with none gets no shelf', () => {
  const plain = tmpProject();
  assert.match(call(plain, 'propose_goal', { agent: 'commander', title: 'G', founderWords: 'g' }).error ?? '', /^$/);
  call(plain, 'judge_goal', { agent: 'commander', goalId: 'g1', fit: 'x', cost: 'x', risks: 'x', strongerVersion: 'none', recommendation: 'keep', reason: 'x' });
  assert.ok(!JSON.parse(fs.readFileSync(path.join(plain, '.warroom/goals.json'), 'utf8'))[0].verdict, 'the commander must say whether the goal needs learning');
  const noLearn = tmpProject();
  judged(noLearn, []);
  assert.ok(!call(noLearn, 'set_plan', { agent: 'commander', goalId: 'g1', milestones: [{ title: 'A', win: 'w', checks: ['a1'] }] }).json.next);
  assert.ok(!page(noLearn).includes('data-go="shelf"'), 'no learning and nothing shelved: no Shelf tab');
  assert.doesNotMatch(brief(noLearn), /Learning notes/);

  const dir = tmpProject();
  judged(dir, ['事件溯源', '種子隨機']);
  assert.match(call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones: [{ title: 'A', win: 'w', checks: ['a1'] }] }).json.next, /事件溯源; 種子隨機/);
  assert.match(brief(dir), /Learning notes still to write[^\n]*\n- g1: 事件溯源; 種子隨機/);
  assert.match(page(dir), /data-go="shelf"/);
  assert.match(page(dir), /To learn for: G[\s\S]*0\/2 written[\s\S]*Note not written yet/);
  assert.match(call(dir, 'shelve', { agent: 'commander', path: 'docs/學習/01-事件溯源.md', goalId: 'g1', topic: 'nope' }).error, /not on g1's learning list/);
  assert.match(call(dir, 'shelve', { agent: 'commander', path: 'docs/學習/01-事件溯源.md', topic: '事件溯源' }).error, /pass goalId/);
  assert.equal(call(dir, 'shelve', { agent: 'commander', path: 'docs/學習/01-事件溯源.md', goalId: 'g1', topic: '事件溯源' }).error, null);
  assert.match(brief(dir), /- g1: 種子隨機\n/);
  assert.match(page(dir), /1\/2 written[\s\S]*data-book="b1"><span class="spine-t">事件溯源/);
});

test('milestones: as many as the goal needs, never zero, and each with a check', () => {
  const dir = tmpProject();
  judged(dir, []);
  const plan = (milestones) => call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones });
  assert.equal(plan([{ title: 'Only', win: 'w', checks: ['c'] }]).json.milestones.length, 1);
  assert.equal(plan(Array.from({ length: 12 }, (_, i) => ({ title: `M${i}`, win: 'w', checks: [`c${i}`] }))).json.milestones.length, 12);
  assert.match(plan([]).error, /at least one milestone/);
  assert.match(plan([{ title: 'Empty', win: 'w', checks: [] }]).error, /"Empty" has no check/);
});

test('study bar: the founder marks notes read; the bar counts read notes out of all topics to learn', async (tc) => {
  const dir = tmpProject();
  judged(dir, ['事件溯源', '種子隨機']);
  call(dir, 'set_plan', { agent: 'commander', goalId: 'g1', milestones: [{ title: 'A', win: 'w', checks: ['a1'] }] });
  call(dir, 'shelve', { agent: 'commander', path: 'docs/學習/01-事件溯源.md', goalId: 'g1', topic: '事件溯源' });
  assert.match(page(dir), /Your study[\s\S]*0 of 2 read<\/em>[\s\S]*1 note not written yet/);
  const port = 45000 + Math.floor(Math.random() * 900);
  const srv = spawn(process.execPath, [CLI, 'serve', '--port', String(port)], { cwd: dir, env: { ...process.env, WAR_ROOM_DIR: dir } });
  tc.after(() => srv.kill());
  await new Promise((r) => srv.stdout.once('data', r));
  const read = (body) => fetch(`http://127.0.0.1:${port}/api/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  assert.equal((await read({ id: 'b1', read: true })).status, 200);
  assert.match((await read({ id: 'b9' })).body.error, /No note b9/);
  assert.match(page(dir), /1 of 2 read<\/em>[\s\S]*1 note not written yet[\s\S]*✓ Read/);
  const status = JSON.parse(spawnSync(process.execPath, [CLI, 'call', 'war_room_status'], { cwd: dir, encoding: 'utf8' }).stdout);
  assert.deepEqual(status.goals[0].study, { total: 2, written: 1, read: 1 });
  assert.match(brief(dir), /founder has read 1 of 2 learning notes/);
  assert.match(spawnSync(process.execPath, [CLI, 'read', '--note', 'b1', '--undo'], { cwd: dir, encoding: 'utf8' }).stdout, /\[not read\]/);
  assert.match(page(dir), /0 of 2 read<\/em>/);
  // An agent cannot mark the founder's reading from the shell without the founder's yes.
  const guard = spawnSync(process.execPath, [CLI, 'hook-guard'], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'war-room read --note b1' } }), encoding: 'utf8', env: { ...process.env, WAR_ROOM_DIR: '/nonexistent' } }).stdout;
  assert.match(guard, /"ask"/);
});
