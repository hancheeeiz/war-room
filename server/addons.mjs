// Add-ons: features a war room grows for its own founder (a lesson page, a reading tracker, a small script) that the
// plugin cannot know in advance. The commander registers each one; it does nothing until the founder approves it on
// this computer, because its commands were written by a chat. Once approved, the page links to it, `war-room up`
// starts it, and its "waiting" command tells the page, the brief and the daily check what is waiting on someone.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { now, sign, verify } from './store.mjs';

export const ADDON_NAME = /^[a-z0-9][a-z0-9-]{0,30}$/;
export const LOCAL_URL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?(\/[^\s]*)?$/;

const payload = (a) => `addon|${a.name}|${a.url || ''}|${a.start || ''}|${a.waiting || ''}`;
export const addonInForce = (a) => !a.off && verify(payload(a), a.sig);

// The founder approves (or switches off) an add-on. Page and terminal only, like ticking today's goals.
export function approveAddon(store, { name, approve = true }) {
  return store.update('addons', (addons) => {
    const a = addons.find((x) => x.name === name);
    if (!a) throw new Error(`No add-on "${name}".`);
    if (approve) Object.assign(a, { sig: sign(payload(a)), approvedAt: now() }), delete a.off;
    else Object.assign(a, { off: true });
    store.log({ agent: 'founder', event: approve ? 'addon_approved' : 'addon_off', id: a.name });
    return a;
  });
}

// One line per thing waiting, from the add-on's own command. Cached briefly: the page redraws often.
const cache = new Map();
export function waitingFor(store, a, { fresh = false } = {}) {
  if (!a.waiting || !addonInForce(a)) return null;
  const key = `${a.name}|${a.sig}`;
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 60e3) return hit.out;
  const r = spawnSync('/bin/sh', ['-c', a.waiting], { cwd: path.dirname(store.root), encoding: 'utf8', timeout: 5000, env: { ...process.env, WAR_ROOM_AGENT: '' } });
  const out = r.error || r.status !== 0
    ? { error: (r.error?.code === 'ETIMEDOUT' ? 'took longer than 5 s' : (r.stderr || r.error?.message || `exit ${r.status}`)).trim().slice(0, 160), items: [] }
    : { items: r.stdout.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 50) };
  cache.set(key, { at: Date.now(), out });
  return out;
}

export function addonList(store, opts) {
  return store.read('addons').map((a) => ({ ...a, active: addonInForce(a), waitingNow: waitingFor(store, a, opts) }));
}

// `war-room up`: start each approved add-on that has a start command and is not answering yet.
export async function startAddons(store) {
  const started = [];
  for (const a of store.read('addons').filter((x) => x.start && addonInForce(x))) {
    if (a.url) {
      const up = await fetch(a.url, { signal: AbortSignal.timeout(800) }).then(() => true, () => false);
      if (up) continue;
    }
    fs.mkdirSync(path.join(store.root, 'runs'), { recursive: true });
    const log = path.join(store.root, 'runs', `addon-${a.name}.log`);
    const fd = fs.openSync(log, 'a');
    const child = spawn('/bin/sh', ['-c', a.start], { cwd: path.dirname(store.root), detached: true, stdio: ['ignore', fd, fd] });
    child.unref();
    fs.closeSync(fd);
    started.push({ name: a.name, pid: child.pid, log: path.relative(path.dirname(store.root), log) });
  }
  return started;
}
