import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { teamMapSvg, scanProject, changedFiles, projectMapSvg } = await import(`${ROOT}/server/map.mjs`);

test('the team map shows every chat, its state, and the hand-off between steps', () => {
  const svg = teamMapSvg({
    commander: 'commander', brain: 'codex',
    members: [{ name: 'writer', role: 'Script', company: 'OpenAI', state: 'working', task: 't1' }, { name: 'maker', role: 'Video', company: 'Anthropic', state: 'wait', task: 't2' }],
    tasks: [{ id: 't1', agent: 'writer', status: 'claimed' }, { id: 't2', agent: 'maker', status: 'open', after: 't1' }],
  });
  assert.match(svg, /writer/); assert.match(svg, /maker/); assert.match(svg, /brain: codex/);
  assert.match(svg, /t1 → t2/, 'the hand-off is drawn and named');
  assert.match(svg, /working · t1/);
  assert.doesNotMatch(teamMapSvg({ commander: 'c<script>', brain: 'x', members: [], tasks: [] }), /<script>/, 'names are escaped');
});

test('the project map finds folders and imports, and marks what the team touched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'war-room-map-'));
  fs.mkdirSync(path.join(dir, 'app', 'ui'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'app', 'api'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app/ui/page.js'), "import { get } from '../api/client.js';\n");
  fs.writeFileSync(path.join(dir, 'app/api/client.js'), 'export const get = 1;\n');
  fs.writeFileSync(path.join(dir, 'node_modules/x/skip.js'), 'x');
  const scan = scanProject(dir);
  assert.deepEqual(scan.files.sort(), ['app/api/client.js', 'app/ui/page.js']);
  assert.deepEqual(scan.links, [['app/ui/page.js', 'app/api/client.js']]);
  const changed = changedFiles([
    { id: 't1', agent: 'builder', title: 'x', status: 'verified', verifiedAt: new Date().toISOString(), files: ['app/api/client.js'] },
    { id: 't2', agent: 'designer', title: 'y', status: 'claimed', files: ['app/ui'] },
    { id: 't3', agent: 'old', title: 'z', status: 'verified', verifiedAt: '2020-01-01T00:00:00Z', files: ['app/ui/page.js'] },
  ]);
  assert.equal(changed.get('app/api/client.js').kind, 'changed');
  assert.equal(changed.get('app/ui').kind, 'busy');
  assert.equal(changed.has('app/ui/page.js'), false, 'old work is not shown as recent');
  const svg = projectMapSvg(scan, changed);
  assert.match(svg, /app\/api/); assert.match(svg, /client\.js · t1/); assert.match(svg, /app\/ui uses app\/api/);
  assert.match(projectMapSvg({ files: [], links: [] }, new Map()), /No JavaScript/);
});
