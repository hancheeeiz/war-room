import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin/war-room.mjs');
const GUARD = path.join(ROOT, 'bin/guard.mjs');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const HOME = tmp('war-room-hardhome-');
process.env.HOME = HOME;
process.env.WAR_ROOM_HOME = path.join(HOME, '.config', 'war-room');
const env = { ...process.env };
const hook = (input, file = GUARD) => spawnSync(process.execPath, [file], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env: { ...env, WAR_ROOM_DIR: '/nonexistent' } });
const bash = (command, cwd) => hook({ tool_name: 'Bash', tool_input: { command }, cwd }).stdout;

test('the guard asks for hidden pushes, deletes, secrets and agent settings, and leaves normal work alone', () => {
  for (const c of ['g=push; git $g origin main', 'python3 -c "import shutil; shutil.rmtree(\'src\')"', 'node -e "require(\'fs\').rmSync(\'src\',{recursive:true})"', "python3 - <<'X'\nimport os\nos.remove('a')\nX", 'node -e "require(\'child_process\').execSync(x)"', 'curl -X DELETE https://api.example.com/x', 'cat .env', 'cd app && head -5 .env.production', 'cat ~/.ssh/id_rsa', 'echo x >> ~/.codex/config.toml', 'Remove-Item -Recurse -Force src', 'war-room access writer run']) assert.match(bash(c), /needs the founder/, c);
  for (const c of ['git status', 'git -C "$DIR" status', 'git commit -m "$(cat msg)"', 'cat .env.example', 'grep -rn environment src', 'curl -X DELETE http://127.0.0.1:3000/test', 'node -e "console.log(1)"', 'python3 script.py', 'npm test', 'cat README.md']) assert.equal(bash(c, tmp('war-room-empty-')), '', c);
  assert.match(hook({ tool_name: 'Read', tool_input: { file_path: 'C:\\p\\.env' } }).stdout, /secret file/);
  assert.equal(hook({ tool_name: 'Read', tool_input: { file_path: '/p/.env.example' } }).stdout, '');
  assert.match(hook({ tool_name: 'Edit', tool_input: { file_path: '/h/.gemini/settings.json' } }).stdout, /safety settings/);
});

test('the guard reads inside package scripts and shell scripts', () => {
  const dir = tmp('war-room-scripts-');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { deploy: 'echo hi', ship: 'npm run build && npm run send', send: 'firebase deploy', build: 'echo build', test: 'node --test', prelint: 'rm -rf src', lint: 'echo ok' } }));
  fs.writeFileSync(path.join(dir, 'go.sh'), '#!/bin/sh\n# git push would be bad\necho start\n./inner.sh\n');
  fs.writeFileSync(path.join(dir, 'inner.sh'), 'git push origin main\n');
  fs.writeFileSync(path.join(dir, 'fine.sh'), '# rm -rf nothing, only a comment\necho fine\n');
  for (const c of ['npm run deploy', 'npm run ship', 'pnpm ship', 'yarn run lint', './go.sh', 'bash go.sh', 'sh ./inner.sh', `cd ${dir} && ./go.sh`]) assert.match(bash(c, dir), /needs the founder/, c);
  for (const c of ['npm run build', 'npm test', './fine.sh', 'bash fine.sh']) assert.equal(bash(c, dir), '', c);
  assert.match(bash(`npm --prefix ${dir} run ship`, os.tmpdir()), /inside script/);
});

test('a guard that cannot check blocks the action', () => {
  const bad = hook('not json');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /blocked/);
  assert.equal(hook({}).status, 2);
  // Broken plugin files: the entry point still blocks.
  const copy = tmp('war-room-broken-');
  fs.cpSync(path.join(ROOT, 'bin'), path.join(copy, 'bin'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'server'), path.join(copy, 'server'), { recursive: true });
  fs.writeFileSync(path.join(copy, 'server', 'guard.mjs'), 'this is not javascript {{{');
  const r = hook({ tool_name: 'Bash', tool_input: { command: 'ls' } }, path.join(copy, 'bin', 'guard.mjs'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /failed to start/);
  assert.equal(hook({ tool_name: 'Bash', tool_input: { command: 'ls' } }).status, 0);
});

test('chats are limited by access level; only a founder grant gives "run", and it cannot be faked', async () => {
  const { Store } = await import(`${ROOT}/server/store.mjs`);
  const { accessOf, commandFor } = await import(`${ROOT}/server/agents.mjs`);
  const dir = tmp('war-room-access-');
  const cli = (...a) => spawnSync(process.execPath, [CLI, ...a], { cwd: dir, env: { ...env, WAR_ROOM_DIR: dir }, encoding: 'utf8' });
  cli('init', '--project', 'demo');
  const hire = (extra) => cli('call', 'hire', JSON.stringify({ agent: 'commander', name: 'writer', role: 'Writer', ...extra }));
  hire({});
  const store = new Store(path.join(dir, '.warroom'));
  assert.equal(accessOf(store, 'writer'), 'edit');
  assert.equal(accessOf(store, 'commander'), 'run');
  assert.match(hire({ access: 'run' }).stderr + hire({ access: 'run' }).stdout, /Only the founder|must be one of|read or edit/i);
  assert.equal(accessOf(store, 'writer'), 'edit');
  hire({ access: 'read' });
  assert.equal(accessOf(store, 'writer'), 'read');
  assert.match(cli('access', 'writer', 'run').stdout, /writer: run/);
  assert.equal(accessOf(store, 'writer'), 'run');
  const team = store.read('team');
  fs.writeFileSync(path.join(dir, '.warroom', 'team.json'), JSON.stringify(team.map((m) => ({ ...m, grant: 'a'.repeat(64), access: 'run' }))));
  assert.equal(accessOf(store, 'writer'), 'edit', 'a made-up grant or a plain "run" in the file gives nothing extra');
  const args = (mode, agent = 'claude') => commandFor({ agent }, mode, 'p').args.join(' ');
  assert.match(args('read'), /--disallowedTools Bash,Write,Edit/);
  assert.match(args('edit'), /--disallowedTools Bash,Agent,Task/);
  assert.match(args('work'), /--allowedTools Bash,/);
  assert.match(args('read', 'codex'), /--sandbox read-only/);
  assert.throws(() => commandFor({ agent: 'cursor' }, 'edit', 'p'), /cannot be used/);
});

test('one chat per name: a second start is refused, even when several ask at once', async () => {
  const { spawn } = await import('node:child_process');
  const dir = tmp('war-room-twice-');
  const bin = tmp('war-room-twicebin-');
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nsleep 6\n');
  fs.chmodSync(path.join(bin, 'claude'), 0o755);
  const e = { ...env, WAR_ROOM_DIR: dir, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  spawnSync(process.execPath, [CLI, 'init', '--project', 'demo'], { cwd: dir, env: e });
  const start = () => new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, 'spawn', 'writer'], { cwd: dir, env: e });
    let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('close', () => resolve(out));
  });
  const outs = await Promise.all([start(), start(), start(), start()]);
  assert.equal(outs.filter((o) => /worker "writer" started/.test(o)).length, 1, outs.join('\n'));
  assert.equal(outs.filter((o) => /already running/.test(o)).length, 3, outs.join('\n'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.warroom', 'runs.json'), 'utf8')).length, 1);
});
