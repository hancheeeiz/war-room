// War room store: plain JSON files in <project>/.warroom/, safe for several agents at once.
import fs from 'node:fs';
import path from 'node:path';

const FILES = { memory: [], goals: [], tasks: [], messages: [] };

export const MEMORY_KINDS = ['rule', 'never', 'decision', 'pref', 'fact', 'question'];

export function findRoot(start = process.env.WAR_ROOM_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.warroom'))) return path.join(dir, '.warroom');
    const up = path.dirname(dir);
    if (up === dir) return path.join(path.resolve(start), '.warroom');
    dir = up;
  }
}

export class Store {
  constructor(root = findRoot()) {
    this.root = root;
  }

  exists() {
    return fs.existsSync(path.join(this.root, 'config.json'));
  }

  init({ project = path.basename(path.dirname(this.root)), commander = 'commander' } = {}) {
    fs.mkdirSync(this.root, { recursive: true });
    for (const [name, empty] of Object.entries(FILES)) {
      const f = path.join(this.root, `${name}.json`);
      if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify(empty, null, 2));
    }
    const cfg = path.join(this.root, 'config.json');
    if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, JSON.stringify({ project, commander, staleHours: 2, dailyEventBudget: 300, created: now() }, null, 2));
    const gi = path.join(this.root, '.gitignore');
    if (!fs.existsSync(gi)) fs.writeFileSync(gi, 'lock\n*.tmp\n');
    return this.config();
  }

  config() {
    return readJson(path.join(this.root, 'config.json'), {});
  }

  read(name) {
    return readJson(path.join(this.root, `${name}.json`), FILES[name]);
  }

  // Read-modify-write under a lock so two agents never overwrite each other.
  update(name, fn) {
    return this.locked(() => {
      const data = this.read(name);
      const result = fn(data);
      writeJson(path.join(this.root, `${name}.json`), data);
      return result;
    });
  }

  log(event) {
    fs.mkdirSync(this.root, { recursive: true });
    fs.appendFileSync(path.join(this.root, 'log.jsonl'), `${JSON.stringify({ at: now(), ...event })}\n`);
  }

  readLog(limit = 10) {
    const f = path.join(this.root, 'log.jsonl');
    if (!fs.existsSync(f)) return [];
    const lines = fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((l) => JSON.parse(l));
  }

  locked(fn) {
    fs.mkdirSync(this.root, { recursive: true });
    const lock = path.join(this.root, 'lock');
    const deadline = Date.now() + 5000;
    for (;;) {
      try {
        fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
        break;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        // A lock older than 10 s belongs to a crashed process.
        try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.rmSync(lock, { force: true }); } catch {}
        if (Date.now() > deadline) throw new Error('war room is busy (lock held); try again');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }
    try { return fn(); } finally { fs.rmSync(lock, { force: true }); }
  }
}

export function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function nextId(list, prefix) {
  const n = list.reduce((m, x) => Math.max(m, Number(String(x.id).slice(prefix.length)) || 0), 0);
  return `${prefix}${n + 1}`;
}

const STOP = new Set('the a an and or of to in on for with is are be it this that at by from as not no do does we you i they my our your will can should must was were has have had but if then so all any each every new use only'.split(' '));

export function words(text) {
  return [...new Set(String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])].filter((w) => w.length > 2 && !STOP.has(w));
}

export function overlap(a, b) {
  const wb = new Set(words(b));
  return words(a).filter((w) => wb.has(w)).length;
}

function readJson(f, fallback) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return structuredClone(fallback); }
}

function writeJson(f, data) {
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, f);
}
