// The map tab: two pictures drawn as plain SVG, no outside libraries.
//   1. The team map: you, the commander and every chat, with who hands work to whom and what each is doing now.
//      It is drawn from the war room's own records, so nothing is scanned.
//   2. The project map: the folders of the project (JavaScript, TypeScript and Python imports), with the files the
//      team has reported or had checked marked as changed. This is a small take on the idea behind the open-source
//      "floorplan" plugin (MIT, Hayden Smith): a map of the code with recent work highlighted. No code is copied.
import fs from 'node:fs';
import path from 'node:path';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

const STATE = {
  working: ['#4ade80', 'working'], duty: ['#60a5fa', 'standing by'], check: ['#fbbf24', 'being checked'], ready: ['#a78bfa', 'has work'],
  wait: ['#94a3b8', 'waiting for a step'], stopped: ['#f87171', 'stopped'], done: ['#34d399', 'all done'], idle: ['#64748b', 'free'],
};

// ── 1. Team map ──────────────────────────────────────
// members: [{ name, role, company, state, label }]; tasks: the task list (for hand-offs between steps).
export function teamMapSvg({ commander, members, tasks, brain }) {
  const W = 900, rowH = 74, top = 24;
  const H = top * 2 + Math.max(1, members.length) * rowH + 10;
  const pos = new Map();
  const youY = H / 2, cmdY = H / 2;
  pos.set('you', [90, youY]);
  pos.set('@commander', [330, cmdY]);
  members.forEach((m, i) => pos.set(m.name, [610, top + rowH / 2 + i * rowH]));
  const parts = [];
  const line = (a, b, { w = 1.6, color = '#475569', dash = '', curve = 0, label = '' } = {}) => {
    const [x1, y1] = a, [x2, y2] = b;
    const mx = (x1 + x2) / 2 + curve, my = (y1 + y2) / 2;
    parts.push(`<path d="M${x1 + 62},${y1} Q${mx},${my} ${x2 - 78},${y2}" fill="none" stroke="${color}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ''} marker-end="url(#ah)"/>`);
    if (label) parts.push(`<text x="${mx}" y="${my - 5}" class="el" text-anchor="middle">${esc(label)}</text>`);
  };
  line(pos.get('you'), pos.get('@commander'), { w: 2.4, color: '#a78bfa', label: 'your words' });
  for (const m of members) line(pos.get('@commander'), pos.get(m.name), { w: 1.4, color: '#64748b' });
  // Hand-offs: a step that waits for another step is drawn from the member who does the first to the one who does the next.
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Set();
  for (const t of tasks) {
    const before = t.after && byId.get(t.after);
    if (!before || before.agent === t.agent || !pos.has(before.agent) || !pos.has(t.agent)) continue;
    const k = `${before.agent}>${t.agent}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const [x1, y1] = pos.get(before.agent), [x2, y2] = pos.get(t.agent);
    const bend = 64 + 10 * seen.size;
    const hot = ['claimed', 'reported'].includes(before.status) || ['claimed', 'open'].includes(t.status);
    parts.push(`<path d="M${x1 + 78},${y1} C${x1 + 78 + bend},${y1} ${x2 + 78 + bend},${y2} ${x2 + 78},${y2}" fill="none" stroke="${hot ? '#fbbf24' : '#a78bfa'}" stroke-width="2" stroke-dasharray="5 4" marker-end="url(#ah2)"/>`);
    parts.push(`<text x="${Math.max(x1, x2) + 78 + bend * 0.8}" y="${(y1 + y2) / 2}" class="el" text-anchor="start">${esc(`${before.id} → ${t.id}`)}</text>`);
  }
  const box = ([x, y], w, h, fill, stroke, l1, l2, l3) => {
    parts.push(`<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`);
    parts.push(`<text x="${x}" y="${y - (l3 ? 9 : 3)}" class="nt" text-anchor="middle">${esc(clip(l1, 22))}</text>`);
    if (l2) parts.push(`<text x="${x}" y="${y + (l3 ? 7 : 14)}" class="ns" text-anchor="middle">${esc(clip(l2, 28))}</text>`);
    if (l3) parts.push(`<text x="${x}" y="${y + 21}" class="ns" text-anchor="middle">${esc(clip(l3, 28))}</text>`);
  };
  box(pos.get('you'), 124, 50, '#1e1e27', '#a78bfa', 'You', 'the founder');
  box(pos.get('@commander'), 124, 62, '#1e1e27', '#a78bfa', 'Commander', commander, `brain: ${brain}`);
  for (const m of members) {
    const [color, word] = STATE[m.state] || STATE.idle;
    box(pos.get(m.name), 156, 58, '#16161d', color, m.name, `${m.company || m.role || ''}`.trim() || m.role, `${word}${m.task ? ` · ${m.task}` : ''}`);
  }
  const legend = Object.entries(STATE).map(([, [c, w]]) => `<span class="lg"><i style="background:${c}"></i>${esc(w)}</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="mapsvg" role="img" aria-label="Who works with whom in the war room">
<defs><marker id="ah" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#64748b"/></marker><marker id="ah2" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#a78bfa"/></marker></defs>
${parts.join('\n')}</svg><div class="lgs">${legend}<span class="lg"><i class="dash"></i>hand-off between steps</span></div>`;
}

// ── 2. Project map ───────────────────────────────────
const CODE = /\.(m?js|cjs|jsx|tsx?|py)$/i;
const SKIP = new Set(['node_modules', '.git', '.warroom', 'floorplan', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', 'coverage', 'Pods', '.claude', 'outputs']);

export function scanProject(root, { maxFiles = 3000 } = {}) {
  const files = [];
  const walk = (dir, depth) => {
    if (files.length >= maxFiles || depth > 8) return;
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (files.length >= maxFiles) return;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1); continue; }
      if (!CODE.test(e.name)) continue;
      let st;
      try { st = fs.statSync(path.join(dir, e.name)); } catch { continue; }
      if (st.size > 400 * 1024) continue;
      files.push(path.relative(root, path.join(dir, e.name)).split(path.sep).join('/'));
    }
  };
  walk(root, 0);
  const have = new Set(files);
  const edges = new Map();
  const resolve = (from, spec) => {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
    for (const c of [base, ...['.mjs', '.js', '.ts', '.tsx', '.jsx', '.py'].map((x) => base + x), ...['index.js', 'index.ts', 'index.mjs'].map((x) => `${base}/${x}`)]) if (have.has(c)) return c;
    return null;
  };
  for (const f of files) {
    let text = '';
    try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    const specs = [];
    for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) specs.push(m[1]);
    for (const m of text.matchAll(/^\s*from\s+(\.+)([\w.]*)\s+import/gm)) specs.push(`${m[1].length > 1 ? '../'.repeat(m[1].length - 1) : './'}${m[2].replace(/\./g, '/')}`);
    for (const s of specs) {
      const to = resolve(f, s);
      if (to && to !== f) edges.set(`${f}\t${to}`, 1);
    }
  }
  return { files, links: [...edges.keys()].map((k) => k.split('\t')) };
}

// Files the team has reported or had checked, with who and when. status: 'changed' (reported or verified) or 'busy' (a worker holds the task now).
export function changedFiles(tasks, { days = 14, nowMs = Date.now() } = {}) {
  const out = new Map();
  const cut = nowMs - days * 864e5;
  for (const t of tasks) {
    const when = Date.parse(t.verifiedAt || t.report?.date || t.claimed || t.created || '') || 0;
    if (when < cut && !['claimed', 'open'].includes(t.status)) continue;
    const list = [...(t.report?.files || []), ...(t.files || [])];
    for (const raw of list) {
      const f = String(raw).replace(/^\.\//, '').replace(/\/+$/, '');
      if (!f) continue;
      const kind = ['verified', 'reported'].includes(t.status) ? 'changed' : ['claimed'].includes(t.status) ? 'busy' : 'planned';
      const prev = out.get(f);
      const rank = { changed: 3, busy: 2, planned: 1 };
      if (!prev || rank[kind] > rank[prev.kind]) out.set(f, { kind, task: t.id, title: t.title, agent: t.agent });
    }
  }
  return out;
}

export function projectMapSvg({ files, links }, changed) {
  const group = (f) => { const p = f.split('/'); return p.length === 1 ? '(project root)' : p.length > 2 ? `${p[0]}/${p[1]}` : p[0]; };
  const dirs = new Map();
  for (const f of files) { const g = group(f); if (!dirs.has(g)) dirs.set(g, []); dirs.get(g).push(f); }
  // A changed path may be a folder: it marks every file under it.
  const mark = (f) => { for (const [p, v] of changed) if (f === p || f.startsWith(`${p}/`)) return v; return null; };
  const list = [...dirs.entries()].map(([name, fs_]) => ({ name, files: fs_, hits: fs_.map((f) => [f, mark(f)]).filter(([, m]) => m) })).sort((a, b) => b.hits.length - a.hits.length || b.files.length - a.files.length).slice(0, 24);
  if (!list.length) return '<p class="note">No JavaScript, TypeScript or Python files found in this project folder, so there is no code map to draw. The team map above still works.</p>';
  const cols = 3, bw = 226, gap = 34, pad = 20;
  const rows = Math.ceil(list.length / cols);
  const hFor = (d) => 46 + Math.min(d.hits.length, 4) * 15 + (d.hits.length > 4 ? 15 : 0);
  const rowH = [];
  for (let r = 0; r < rows; r += 1) rowH.push(Math.max(...list.slice(r * cols, r * cols + cols).map(hFor)));
  const W = pad * 2 + cols * bw + (cols - 1) * gap;
  const ys = []; let y = pad;
  for (let r = 0; r < rows; r += 1) { ys.push(y); y += rowH[r] + gap; }
  const H = y - gap + pad;
  const at = new Map();
  list.forEach((d, i) => at.set(d.name, { x: pad + (i % cols) * (bw + gap), y: ys[Math.floor(i / cols)], h: hFor(d) }));
  const counts = new Map();
  for (const [a, b] of links) { const ga = group(a), gb = group(b); if (ga !== gb && at.has(ga) && at.has(gb)) counts.set(`${ga}\t${gb}`, (counts.get(`${ga}\t${gb}`) || 0) + 1); }
  const parts = [];
  for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    const [a, b] = k.split('\t'), A = at.get(a), B = at.get(b);
    const x1 = A.x + bw / 2, y1 = A.y + A.h / 2, x2 = B.x + bw / 2, y2 = B.y + B.h / 2;
    parts.push(`<path d="M${x1},${y1} Q${(x1 + x2) / 2},${(y1 + y2) / 2 - 24} ${x2},${y2}" fill="none" stroke="#475569" stroke-opacity=".55" stroke-width="${Math.min(1 + n / 3, 5)}"><title>${esc(a)} uses ${esc(b)} (${n} link${n > 1 ? 's' : ''})</title></path>`);
  }
  for (const d of list) {
    const p = at.get(d.name), busy = d.hits.some(([, m]) => m.kind === 'busy'), chg = d.hits.some(([, m]) => m.kind === 'changed');
    const color = busy ? '#fbbf24' : chg ? '#4ade80' : '#334155';
    parts.push(`<rect x="${p.x}" y="${p.y}" width="${bw}" height="${p.h}" rx="12" fill="#16161d" stroke="${color}" stroke-width="${d.hits.length ? 2.4 : 1.4}"/>`);
    parts.push(`<text x="${p.x + 14}" y="${p.y + 22}" class="nt">${esc(clip(d.name, 26))}</text>`);
    parts.push(`<text x="${p.x + 14}" y="${p.y + 39}" class="ns">${d.files.length} file${d.files.length > 1 ? 's' : ''}${d.hits.length ? ` · ${d.hits.length} touched by the team` : ''}</text>`);
    d.hits.slice(0, 4).forEach(([f, m], i) => {
      const c = m.kind === 'busy' ? '#fbbf24' : m.kind === 'changed' ? '#4ade80' : '#94a3b8';
      parts.push(`<text x="${p.x + 14}" y="${p.y + 58 + i * 15}" class="ns" fill="${c}">${m.kind === 'busy' ? '●' : m.kind === 'changed' ? '✓' : '○'} ${esc(clip(f.split('/').pop(), 20))} · ${esc(m.task)} ${esc(clip(m.agent || '', 10))}</text>`);
    });
    if (d.hits.length > 4) parts.push(`<text x="${p.x + 14}" y="${p.y + 58 + 4 * 15}" class="ns">+ ${d.hits.length - 4} more</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="mapsvg" role="img" aria-label="The project's folders and how they use each other">${parts.join('\n')}</svg>
<div class="lgs"><span class="lg"><i style="background:#4ade80"></i>reported or checked in the last 14 days</span><span class="lg"><i style="background:#fbbf24"></i>a worker has the task now</span><span class="lg"><i style="background:#94a3b8"></i>planned in a task</span><span class="lg">Lines: folders that import each other (thicker = more)</span></div>`;
}

// Reading every file on each redraw would be wasteful: keep a scan for a minute.
const CACHE = new Map();
export function scanProjectCached(root) {
  const hit = CACHE.get(root);
  if (hit && Date.now() - hit.at < 60e3) return hit.value;
  const value = scanProject(root);
  CACHE.set(root, { at: Date.now(), value });
  return value;
}
