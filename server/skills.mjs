// Skills: the war room reads every skill installed on this computer (for Claude Code, Codex and the other agents) and
// puts the ones that fit into each task, so any agent uses them without the founder remembering to ask. When nothing
// installed fits, it searches the public catalogue (skills.sh) and suggests the most trusted results. Installing one
// runs code and instructions written by someone else, so it happens only after the founder approves it on the page.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchSpec, which } from './agents.mjs';
import { now, sign, verify, words } from './store.mjs';

// ── Reading installed skills ─────────────────────────
// The founder's own skills first, so a project's files can never replace a trusted skill by using its name; then the
// project's own; then the ones plugins bring.
export function skillDirs(project, home = os.homedir()) {
  const dirs = [
    [path.join(home, '.claude', 'skills'), 'yours'],
    [path.join(home, '.agents', 'skills'), 'yours (shared by your agents)'],
    [path.join(home, '.codex', 'skills'), 'Codex'],
    [path.join(project, '.claude', 'skills'), 'project'],
    [path.join(project, '.agents', 'skills'), 'project'],
  ];
  // Plugins: ~/.claude/plugins/cache/<market>/<plugin>/<version>/skills, newest version of each plugin only.
  const cache = path.join(home, '.claude', 'plugins', 'cache');
  for (const market of safeList(cache)) for (const plugin of safeList(path.join(cache, market))) {
    const versions = safeList(path.join(cache, market, plugin)).sort((a, b) => fs.statSync(path.join(cache, market, plugin, b)).mtimeMs - fs.statSync(path.join(cache, market, plugin, a)).mtimeMs);
    if (versions[0] && plugin !== 'war-room') dirs.push([path.join(cache, market, plugin, versions[0], 'skills'), `plugin ${plugin}`]);
  }
  return dirs;
}

function safeList(dir) {
  try { return fs.readdirSync(dir).filter((x) => !x.startsWith('.')); } catch { return []; }
}

// The name and description from a SKILL.md's frontmatter (a small YAML subset: plain, quoted or folded values).
export function readFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const kv = /^(name|description):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^[>|][-+]?$/.test(v) || v === '') {
      const more = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) more.push(lines[++i].trim());
      v = more.join(' ');
    }
    out[kv[1]] = v.replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
  }
  return out;
}

const cache = new Map();
export function installedSkills(project, { fresh = false, home } = {}) {
  const key = `${project}|${home || ''}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 5 * 60e3) return hit.list;
  const seen = new Set();
  const list = [];
  for (const [dir, source] of skillDirs(project, home)) {
    for (const name of safeList(dir)) {
      const file = path.join(dir, name, 'SKILL.md');
      let text;
      try { text = fs.readFileSync(file, 'utf8').slice(0, 8000); } catch { continue; }
      const fm = readFrontmatter(text);
      const id = fm.name || name;
      if (seen.has(id)) continue;
      seen.add(id);
      list.push({ name: id, description: String(fm.description || '').slice(0, 500), file, source });
    }
  }
  cache.set(key, { at: Date.now(), list });
  return list;
}

// Skill names are hyphenated ("firestore-rules-change"); split them so each part can match the task's words.
const nameWords = (n) => words(String(n).toLowerCase().replace(/[-_]+/g, ' '));

// The skills that fit a piece of work, best first. A word shared by many skills ("review", "create") says little, so
// each word counts by how rare it is among the installed skills, and a skill must share a rare word of its own name.
const GENERIC = new Set(['skill', 'skills', 'basics', 'create', 'maintain', 'use', 'using', 'how', 'help', 'helps', 'when', 'user', 'users', 'asks', 'task', 'tasks', 'work', 'make', 'build', 'review', 'check', 'agent', 'agents', 'claude', 'code', 'write', 'writing', 'run', 'add', 'fix', 'test', 'tests', 'data', 'file', 'files', 'app', 'apps', 'page', 'new', 'set', 'get', 'principle', 'learning', 'loop', 'expert', 'first', 'work', 'show', 'correct', 'figure']);
export function matchSkills(text, skills, limit = 3) {
  const tw = new Set([...words(text), ...nameWords(text)].filter((w) => !GENERIC.has(w)));
  const lower = String(text).toLowerCase();
  const docs = skills.map((s) => ({ s, nw: nameWords(s.name).filter((w) => !GENERIC.has(w)), dw: new Set(words(s.description).filter((w) => !GENERIC.has(w))) }));
  const df = new Map();
  for (const d of docs) for (const w of new Set([...d.nw, ...d.dw])) df.set(w, (df.get(w) || 0) + 1);
  // 1 for a word only one skill has, near 0 for a word every skill has, whatever the number of skills installed.
  const weight = (w) => Math.log((docs.length + 1) / (df.get(w) || 1)) / Math.log(docs.length + 1);
  return docs
    .map(({ s, nw, dw }) => {
      // The task names the skill: whole words only ("loop" is not in "Comfort Loop"'s sense unless it is the skill's
      // full multi-word name), and never a short or everyday one-word name.
      const full = s.name.toLowerCase().replace(/[.]/g, '\\.').replace(/[-_]+/g, '[-_ ]');
      if (s.name.length >= 5 && s.name.split(/[-_]+/).length >= 2 && new RegExp(`(^|[^\\p{L}\\p{N}])${full}($|[^\\p{L}\\p{N}])`, 'u').test(lower)) return { ...s, score: 100, strong: true };
      const nameHits = nw.filter((w) => tw.has(w));
      const descHits = [...dw].filter((w) => tw.has(w) && !nameHits.includes(w));
      const score = nameHits.reduce((n, w) => n + 2 * weight(w), 0) + descHits.reduce((n, w) => n + weight(w), 0);
      // Sure: the task says the skill's name, shares two words of it, or a name word plus the description agrees.
      // Otherwise it is only a candidate: the agent reads its description and decides.
      const strong = nameHits.length >= 2 || (nameHits.length >= 1 && descHits.length >= 1 && score >= 2.4);
      return { ...s, score, strong };
    })
    .filter((x) => x.strong || x.score >= 1.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function skillsText(list) {
  if (!list?.length) return null;
  const sure = list.filter((s) => s.strong !== false);
  const maybe = list.filter((s) => s.strong === false);
  return [
    ...(sure.length ? ['Skills for this task (read each SKILL.md before you start and follow it; any agent can read the file):', ...sure.map((s) => `- ${s.name}${s.source === 'project' ? ' (from this project\'s own files)' : ''}: ${s.file}`)] : []),
    ...(maybe.length ? ['Skills that may fit (use one only if its description clearly applies to this task):', ...maybe.map((s) => `- ${s.name} — ${String(s.description || '').slice(0, 140)}: ${s.file}`)] : []),
  ].join('\n');
}

// ── Searching the public catalogue ───────────────────
// Install counts can be faked by copies, so trust comes from who publishes it: a known organisation, or a GitHub
// repository with many stars. Results that pass neither are not suggested.
export const KNOWN = ['anthropics', 'vercel-labs', 'vercel', 'microsoft', 'google', 'google-gemini', 'openai', 'github', 'firebase', 'supabase', 'stripe', 'cloudflare', 'heygen-com', 'figma', 'notion', 'expo', 'remotion-dev', 'shadcn', 'mattpocock'];
export const SOURCE = /^(?!.*\.\.)[A-Za-z0-9][\w.-]{0,60}\/[A-Za-z0-9][\w.-]{0,100}$/;
export const SKILL = /^(?!.*\.\.)[A-Za-z0-9][\w.-]{0,99}$/;
export const skillUrl = (s) => `https://skills.sh/${s.source}/${s.skill}`;

async function getJson(url, ms = 8000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'war-room', accept: 'application/json' } });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return r.json();
}

export async function searchCatalogue(query, { minStars = 500, limit = 3 } = {}) {
  const data = await getJson(`https://skills.sh/api/search?q=${encodeURIComponent(query)}`);
  const raw = (data.skills || []).filter((s) => SOURCE.test(s.source || '') && SKILL.test(s.skillId || s.name || ''));
  // Many copies of one skill: keep the most installed copy per skill name.
  const best = new Map();
  for (const s of raw) { const k = s.skillId || s.name; if (!best.has(k) || best.get(k).installs < s.installs) best.set(k, s); }
  const out = [];
  for (const s of [...best.values()].sort((a, b) => b.installs - a.installs).slice(0, 5)) {
    const owner = s.source.split('/')[0].toLowerCase();
    let stars = null;
    try { stars = (await getJson(`https://api.github.com/repos/${s.source}`, 6000)).stargazers_count ?? null; } catch {}
    const known = KNOWN.includes(owner);
    if (!known && !(stars >= minStars)) continue;
    out.push({ source: s.source, skill: s.skillId || s.name, installs: s.installs || 0, stars, known });
    if (out.length >= limit) break;
  }
  return out;
}

// ── Suggestions and the founder's approval ───────────
const payload = (s) => `skill|${s.id}|${s.source}|${s.skill}`;
export const installCommand = (s) => ['skills', 'add', s.source, '--skill', s.skill, '--agent', '*', '--global', '--yes'];

// Store new suggestions for a need (a task or a role), skipping skills already suggested or installed.
export function suggest(store, { need, query, results }) {
  const have = new Set(installedSkills(path.dirname(store.root)).map((s) => s.name));
  return store.update('skills', (all) => {
    const added = [];
    for (const r of results) {
      if (have.has(r.skill) || all.some((x) => x.source === r.source && x.skill === r.skill)) continue;
      const s = { id: `k${all.length + 1}`, ...r, need, query, status: 'suggested', at: now() };
      all.push(s);
      added.push(s);
    }
    if (added.length) store.log({ agent: 'war-room', event: 'skills_suggested', text: `${query}: ${added.map((x) => `${x.source}@${x.skill}`).join(', ')}` });
    return added;
  });
}

export const approvedSkill = (s) => verify(payload(s), s.sig);

// The founder approves (the war room installs it for every agent) or declines a suggestion. Page and terminal only.
export function decideSkill(store, { id, approve }) {
  const s = store.update('skills', (all) => {
    const x = all.find((y) => y.id === id);
    if (!x) throw new Error(`No suggestion ${id}.`);
    // A failed install, or one that never finished (the page or terminal was closed), can be tried again.
    const stuck = x.status === 'installing' && Date.now() - new Date(String(x.decided).replace(' ', 'T')).getTime() > 15 * 60e3;
    if (!(x.status === 'suggested' || (approve && (x.status === 'failed' || stuck)))) throw new Error(`${id} is already ${x.status}.`);
    if (approve) Object.assign(x, { status: 'installing', sig: sign(payload(x)), decided: now() });
    else Object.assign(x, { status: 'declined', decided: now() });
    store.log({ agent: 'founder', event: approve ? 'skill_approved' : 'skill_declined', id, text: `${x.source}@${x.skill}` });
    return x;
  });
  if (approve) install(store, s);
  return s;
}

function install(store, s) {
  const set = (patch) => { try { store.update('skills', (all) => { const x = all.find((y) => y.id === s.id); if (x) Object.assign(x, patch); }); } catch {} };
  if (!approvedSkill(s) || !SOURCE.test(s.source) || !SKILL.test(s.skill)) { set({ status: 'failed', note: 'not approved on this computer' }); return; }
  try { installNow(store, s, set); } catch (e) { set({ status: 'failed', note: e.message }); }
}

function installNow(store, s, set) {
  const npx = which('npx');
  if (!npx) { set({ status: 'failed', note: 'npx (Node.js) is not installed' }); return; }
  fs.mkdirSync(path.join(store.root, 'runs'), { recursive: true });
  const log = path.join(store.root, 'runs', `skill-${s.id}.log`);
  const fd = fs.openSync(log, 'a');
  const ls = launchSpec(npx, ['--yes', ...installCommand(s)]);
  const child = spawn(ls.bin, ls.args, { ...ls.opts, cwd: os.homedir(), stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  let finished = false;
  const done = (ok, note) => {
    if (finished) return;
    finished = true;
    set({ status: ok ? 'installed' : 'failed', ...(note ? { note } : {}), finished: now() });
    try { store.log({ agent: 'war-room', event: ok ? 'skill_installed' : 'skill_failed', id: s.id, text: `${s.source}@${s.skill}` }); } catch {}
    cache.clear();
  };
  child.on('error', (e) => done(false, e.message));
  child.on('exit', (code) => done(code === 0, code === 0 ? undefined : `exit ${code}; see .warroom/runs/skill-${s.id}.log`));
}
