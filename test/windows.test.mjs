// Windows behaviour, checked from any computer: these build the exact commands and files Windows would get.
// They cannot prove Windows runs them; the founder's first run on the Windows laptop does that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin/war-room.mjs');
const { which, launchSpec, shellSpec } = await import(`${ROOT}/server/agents.mjs`);
const { vbsText, startupFile } = await import(`${ROOT}/server/engine.mjs`);

test('finds claude.cmd and codex.cmd the way npm installs them on Windows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'war-room-winbin-'));
  // npm writes all three side by side; only the .cmd runs on Windows.
  for (const f of ['claude', 'claude.cmd', 'claude.ps1']) fs.writeFileSync(path.join(dir, f), 'x');
  const env = { PATH: `C:\\nothing;${dir}`, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  // path.win32.join keeps the folder as given; on this test computer the folder uses forward slashes.
  assert.match(which('claude', { platform: 'win32', env }) || '', /claude\.cmd$/i);
  assert.equal(which('codex', { platform: 'win32', env }), null);
  assert.equal(which('claude', { platform: 'darwin', env: { PATH: dir } }), path.join(dir, 'claude'), 'Mac and Linux use the bare name');
});

test('a .cmd agent starts through cmd.exe with its text made safe for it', () => {
  const s = launchSpec('C:\\Users\\f\\AppData\\Roaming\\npm\\codex.cmd', ['exec', '--full-auto', 'Say "hi" & 100% done\nnext line'], { platform: 'win32', env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' } });
  assert.equal(s.bin, 'C:\\Windows\\system32\\cmd.exe');
  assert.deepEqual(s.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(s.args[3], '""C:\\Users\\f\\AppData\\Roaming\\npm\\codex.cmd" "exec" "--full-auto" "Say \'hi\' & 100 percent done next line""');
  assert.equal(s.opts.windowsVerbatimArguments, true);
  assert.equal(s.opts.windowsHide, true);
  const exe = launchSpec('C:\\tools\\gemini.exe', ['-p', 'x'], { platform: 'win32', env: {} });
  assert.equal(exe.bin, 'C:\\tools\\gemini.exe', 'a real .exe starts directly');
  assert.deepEqual(launchSpec('/usr/local/bin/claude', ['-p', 'x'], { platform: 'darwin' }).args, ['-p', 'x']);
  assert.deepEqual(shellSpec('"C:\\Program Files\\notify.exe" hello', { platform: 'win32', env: {} }).args, ['/d', '/s', '/c', '""C:\\Program Files\\notify.exe" hello"'], 'the whole line is wrapped, so its own quotes survive /s');
  assert.deepEqual(shellSpec('npm run learn', { platform: 'linux' }), { bin: '/bin/sh', args: ['-c', 'npm run learn'], opts: {} });
});

test('the Windows startup script runs the engine hidden, with paths quoted', () => {
  const v = vbsText({ node: 'C:\\Program Files\\nodejs\\node.exe', cli: 'C:\\Users\\F "x"\\war-room\\bin\\war-room.mjs' });
  assert.match(v, /CreateObject\("WScript\.Shell"\)\.Run """C:\\Program Files\\nodejs\\node\.exe"" ""C:\\Users\\F ""x""\\war-room\\bin\\war-room\.mjs"" engine run", 0, False/);
  assert.equal(startupFile({ APPDATA: 'C:\\Users\\F\\AppData\\Roaming' }), 'C:\\Users\\F\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\war-room-engine.vbs');
});

test('the guard reads Windows paths and asks before a chat makes something start at login there', () => {
  const guard = (input) => spawnSync(process.execPath, [CLI, 'hook-guard'], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, WAR_ROOM_DIR: '/nonexistent' } }).stdout;
  assert.match(guard({ tool_name: 'Write', tool_input: { file_path: 'C:\\proj\\.warroom\\approvals.json' } }), /editing war-room approvals/);
  assert.match(guard({ tool_name: 'Write', tool_input: { file_path: 'C:\\Users\\F\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\x.vbs' } }), /start by itself/);
  assert.match(guard({ tool_name: 'Bash', tool_input: { command: 'schtasks /Create /SC ONLOGON /TN x /TR evil.exe' } }), /start by itself/);
  assert.match(guard({ tool_name: 'Bash', tool_input: { command: 'reg add HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v x /d evil.exe' } }), /start by itself/);
});

test('connecting Codex lets war-room calls wait long enough to stand by, and refreshes an old project note', async () => {
  const { connectAgent } = await import(`${ROOT}/server/agents.mjs`);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'war-room-codexhome-'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'war-room-codexproj-'));
  const saved = process.env.HOME;
  process.env.HOME = home;
  try {
    fs.mkdirSync(path.join(home, '.codex'));
    fs.writeFileSync(path.join(home, '.codex', 'config.toml'), 'model = "x"\n\n[mcp_servers.war-room]\ncommand = "node"\nargs = ["/old/index.mjs"]\n');
    fs.writeFileSync(path.join(proj, 'AGENTS.md'), '# Rules\n\n<!-- war-room -->\nold note\n<!-- /war-room -->\n');
    const out = connectAgent('codex', { project: proj, write: true });
    assert.match(out.changes.join('\n'), /wait up to 150 s[\s\S]*update the war-room note/);
    assert.match(fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8'), /\[mcp_servers\.war-room\]\ntool_timeout_sec = 150\ncommand/);
    const notes = fs.readFileSync(path.join(proj, 'AGENTS.md'), 'utf8');
    assert.match(notes, /^# Rules/);
    assert.match(notes, /call `wait_for_work` with that name/);
    assert.doesNotMatch(notes, /old note/);
    assert.equal(connectAgent('codex', { project: proj }).changes.length, 0, 'nothing more to change');
    connectAgent('codex', { project: proj, write: true });
    assert.equal(fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8').match(/tool_timeout_sec/g).length, 1, 'connecting again never adds a second timeout line');
    assert.match(fs.readFileSync(path.join(home, '.codex', 'config.toml.before-war-room'), 'utf8'), /\/old\/index\.mjs"\]\n$/, 'the backup stays the very first original');
  } finally { process.env.HOME = saved; }
});
