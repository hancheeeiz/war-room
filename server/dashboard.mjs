// Static HTML command-post dashboard rendered from the store. No server, no dependencies: open the file.
import { now } from './store.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS'];

// XP is earned only by verified work and founder decisions, so the number cannot be gamed by chatter.
function scoring(goals, tasks, memory, log) {
  const checks = goals.flatMap((g) => (g.milestones || []).flatMap((m) => m.checks || []));
  const verifiedChecks = checks.filter((c) => c.verified).length;
  const verifiedTasks = tasks.filter((t) => t.status === 'verified').length;
  const decisions = memory.filter((m) => m.kind === 'decision' && m.status === 'active').length;
  const clearedLevels = goals.flatMap((g) => g.milestones || []).filter((m) => m.checks?.length && m.checks.every((c) => c.verified)).length;
  const xp = verifiedChecks * 100 + verifiedTasks * 50 + clearedLevels * 250 + decisions * 5;
  const level = Math.floor(Math.sqrt(xp / 100)) + 1;
  const floor = (level - 1) ** 2 * 100;
  const next = level ** 2 * 100;
  const days = new Set(log.filter((e) => e.event === 'verified').map((e) => e.at.slice(0, 10)));
  let streak = 0;
  for (let d = new Date(); days.has(d.toISOString().slice(0, 10)); d.setDate(d.getDate() - 1)) streak += 1;
  return { xp, level, rank: RANKS[Math.min(RANKS.length - 1, Math.floor((level - 1) / 3))], into: xp - floor, span: next - floor, streak, verifiedChecks, totalChecks: checks.length, verifiedTasks, clearedLevels, decisions };
}

function achievements(s, memory, goals, tasks) {
  const list = [
    ['🧠', 'Archivist', '100 memories kept', memory.filter((m) => m.status === 'active').length >= 100],
    ['⚖️', 'Judged', 'A goal went through judgement', goals.some((g) => g.verdict)],
    ['🗺️', 'Cartographer', 'A plan with 5+ levels', goals.some((g) => (g.milestones || []).length >= 5)],
    ['✅', 'First Blood', 'First check verified', s.verifiedChecks >= 1],
    ['🏰', 'Level Cleared', 'A whole level verified', s.clearedLevels >= 1],
    ['🛡️', 'Party of Three', '3 chats with tasks', new Set(tasks.map((t) => t.agent)).size >= 3],
    ['🔥', 'On Fire', '3-day verified streak', s.streak >= 3],
    ['👑', 'Boss Down', 'A goal fully complete', goals.some((g) => g.status === 'done' || ((g.milestones || []).length && g.milestones.every((m) => m.checks?.every((c) => c.verified))))],
  ];
  return list.map(([icon, name, how, got]) => ({ icon, name, how, got }));
}

function pct(n, d) {
  return d ? Math.round((n / d) * 100) : 0;
}

function bar(p, cls = '') {
  return `<div class="bar ${cls}"><i style="width:${p}%"></i></div>`;
}

function chip(status) {
  return `<span class="chip s-${esc(status)}">${esc(status)}</span>`;
}

// Cap a list at `max` visible rows; the rest folds behind "show more".
function capped(rows, max = 10) {
  if (rows.length <= max) return rows.join('');
  return `${rows.slice(0, max).join('')}<details><summary>+ ${rows.length - max} more</summary>${rows.slice(max).join('')}</details>`;
}

function levelMap(g) {
  const ms = g.milestones || [];
  let currentFound = false;
  return `<ol class="map">${ms.map((m, i) => {
    const p = pct(m.checks.filter((c) => c.verified).length, m.checks.length);
    let state = 'locked';
    if (p === 100) state = 'cleared';
    else if (!currentFound) { state = 'current'; currentFound = true; }
    const checks = m.checks.map((c) => `<li class="${c.verified ? 'ok' : ''}">${c.verified ? '◆' : '◇'} ${esc(c.text)}</li>`).join('');
    return `<li class="node ${state}">
      <div class="orb">${state === 'cleared' ? '✓' : i + 1}</div>
      <div class="node-body">
        <div class="node-head"><span class="lv">LV ${i + 1}</span><b>${esc(m.title)}</b>${state === 'current' ? '<span class="here">◀ YOU ARE HERE</span>' : ''}</div>
        ${bar(p, state)}
        <details${state === 'current' ? ' open' : ''}><summary>${m.checks.filter((c) => c.verified).length}/${m.checks.length} checks · win: ${esc(m.win)}</summary><ul class="checks">${checks}</ul></details>
      </div></li>`;
  }).join('')}</ol>`;
}

export function renderDashboard(store) {
  const cfg = store.config();
  const goals = store.read('goals').filter((g) => g.status !== 'dropped');
  const tasks = store.read('tasks');
  const messages = store.read('messages');
  const memory = store.read('memory');
  const log = store.readLog(100000);
  const today = now().slice(0, 10);
  const s = scoring(goals, tasks, memory, log);
  const ach = achievements(s, memory, goals, tasks);
  const questions = memory.filter((m) => m.kind === 'question' && m.status === 'active');
  const openMsgs = messages.filter((m) => m.open);
  const reports = tasks.filter((t) => t.status === 'reported');
  const agents = [...new Set(tasks.map((t) => t.agent))];
  const main = goals.find((g) => g.status === 'active') || goals[0];

  // ── HUD ──────────────────────────────────────────────
  const hud = `<header class="hud">
    <div class="crest"><div class="rank">${s.rank}</div><div class="rank-l">RANK</div></div>
    <div class="who">
      <div class="title">WAR ROOM <span>//</span> ${esc(cfg.project)}</div>
      <div class="lvline"><b>COMMANDER LV ${s.level}</b><span>${s.into} / ${s.span} XP to LV ${s.level + 1}</span></div>
      ${bar(pct(s.into, s.span), 'xp')}
    </div>
    <div class="streak"><div class="flame">${s.streak ? '🔥' : '·'}</div><b>${s.streak}</b><span>day streak</span></div>
  </header>`;

  const tiles = [
    ['QUESTS', goals.filter((g) => !['done', 'later'].includes(g.status)).length, 'active goals', ''],
    ['PROGRESS', `${pct(s.verifiedChecks, s.totalChecks)}%`, `${s.verifiedChecks}/${s.totalChecks} checks verified`, ''],
    ['PARTY', agents.length, `${tasks.filter((t) => ['claimed', 'open'].includes(t.status)).length} tasks in play`, ''],
    ['SUMMONS', questions.length + reports.length, `${questions.length} for you · ${reports.length} to verify`, questions.length ? 'alert' : ''],
    ['MEMORY', memory.filter((m) => m.status === 'active' && m.kind !== 'question').length, 'things never asked twice', ''],
    ['TOTAL XP', s.xp, `${s.clearedLevels} levels cleared`, ''],
  ].map(([k, v, sub, cls]) => `<div class="tile ${cls}"><span class="k">${k}</span><b>${esc(v)}</b><span class="sub">${esc(sub)}</span></div>`).join('');

  // ── Command (overview) ──────────────────────────────
  const todayItems = main ? (main.daily?.[today] || []).map((it) => {
    const t = tasks.find((x) => x.id === it.taskId);
    const done = t ? t.status === 'verified' : !!it.done;
    return `<li class="${done ? 'done' : ''}"><span class="box">${done ? '✓' : ''}</span>${esc(it.text)}<em>+50 XP</em></li>`;
  }) : [];
  const mainCard = main ? `<section class="panel boss">
      <div class="panel-h"><span class="tag">MAIN QUEST</span>${chip(main.status)}</div>
      <h2>${esc(main.title)}</h2>
      <div class="bossbar">${bar(pct((main.milestones || []).flatMap((m) => m.checks).filter((c) => c.verified).length, (main.milestones || []).flatMap((m) => m.checks).length), 'boss')}<span>${pct((main.milestones || []).flatMap((m) => m.checks).filter((c) => c.verified).length, (main.milestones || []).flatMap((m) => m.checks).length)}% · ${(main.milestones || []).length} levels</span></div>
      ${main.intake?.byWhen ? `<div class="meta">⏳ ${esc(main.intake.byWhen)}</div>` : ''}
    </section>` : '<section class="panel"><p class="muted">No quest yet. Start one with <code>/war-room</code>.</p></section>';
  const dailyCard = `<section class="panel"><div class="panel-h"><span class="tag">DAILY QUESTS</span><span class="muted">${today}</span></div><ul class="daily">${todayItems.join('') || '<li class="muted">No daily quests set.</li>'}</ul></section>`;
  const summonsRows = [
    ...questions.map((q) => `<li class="sum q"><span class="ic">❓</span><div><b>${esc(q.id)}</b> ${esc(q.text)}<div class="muted">answer: <code>war-room answer --question ${esc(q.id)} --text "…"</code></div></div></li>`),
    ...reports.map((t) => `<li class="sum r"><span class="ic">📦</span><div><b>${esc(t.id)}</b> ${esc(t.agent)} reports: ${esc(t.title)}<div class="muted">commander must verify</div></div></li>`),
  ];
  const summonsCard = `<section class="panel"><div class="panel-h"><span class="tag ${questions.length ? 'hot' : ''}">SUMMONS</span><span class="muted">${summonsRows.length}</span></div><ul class="list">${capped(summonsRows, 5) || '<li class="muted">All clear. Nothing waits on you.</li>'}</ul></section>`;
  const recent = log.slice(-10).reverse().map((e) => `<li><span class="t">${esc(e.at.slice(11))}</span><b>${esc(e.agent || '·')}</b> ${esc(e.event.replace(/_/g, ' '))} <span class="muted">${esc(e.id || '')}</span></li>`);
  const feedCard = `<section class="panel"><div class="panel-h"><span class="tag">LIVE FEED</span><span class="muted">last 10</span></div><ul class="feed">${recent.join('') || '<li class="muted">Quiet.</li>'}</ul></section>`;
  const achCard = `<section class="panel"><div class="panel-h"><span class="tag">ACHIEVEMENTS</span><span class="muted">${ach.filter((a) => a.got).length}/${ach.length}</span></div><div class="ach">${ach.map((a) => `<div class="badge ${a.got ? 'got' : ''}" title="${esc(a.how)}"><span>${a.icon}</span><b>${esc(a.name)}</b><em>${esc(a.how)}</em></div>`).join('')}</div></section>`;

  const command = `<div class="grid">
    <div class="col">${mainCard}${dailyCard}${main ? `<section class="panel"><div class="panel-h"><span class="tag">LEVEL MAP</span></div>${levelMap(main)}</section>` : ''}</div>
    <div class="col">${summonsCard}${feedCard}${achCard}</div>
  </div>`;

  // ── Party ────────────────────────────────────────────
  const party = agents.map((agent) => {
    const ts = tasks.filter((t) => t.agent === agent);
    const live = ts.find((t) => ['claimed', 'rejected', 'reported', 'open'].includes(t.status));
    const done = ts.filter((t) => t.status === 'verified').length;
    const state = !live ? 'idle' : live.status === 'claimed' ? 'fighting' : live.status === 'reported' ? 'returning' : live.status === 'rejected' ? 'wounded' : 'ready';
    return `<section class="panel member ${state}">
      <div class="avatar">${esc(agent.slice(0, 2).toUpperCase())}</div>
      <div class="m-body"><div class="panel-h"><b>${esc(agent)}</b><span class="state">${state.toUpperCase()}</span></div>
        <div class="muted">${live ? `${esc(live.id)} · ${esc(live.title)}` : 'No quest assigned'}</div>
        ${bar(pct(done, ts.length), 'hp')}<div class="muted">${done}/${ts.length} quests verified${live?.model ? ` · ${esc(live.model)} model` : ''}</div>
      </div></section>`;
  }).join('') || '<section class="panel"><p class="muted">No party yet. The commander adds chats by creating tasks.</p></section>';

  // ── Quests (all goals) ─────────────────────────────
  const quests = goals.map((g) => `<section class="panel"><div class="panel-h"><span class="tag">${g === main ? 'MAIN' : 'SIDE'} QUEST</span>${chip(g.status)}</div><h2>${esc(g.title)}</h2>
    ${g.verdict ? `<div class="verdict"><b>⚖ ${esc(g.verdict.recommendation)}</b> — ${esc(g.verdict.reason)}</div>` : ''}
    ${(g.milestones || []).length ? levelMap(g) : '<p class="muted">Awaiting plan.</p>'}</section>`).join('') || '<section class="panel"><p class="muted">No quests.</p></section>';

  // ── Memory vault ───────────────────────────────────
  const kinds = ['rule', 'never', 'decision', 'pref', 'fact'];
  const active = memory.filter((m) => m.status === 'active' && m.kind !== 'question');
  const vault = `<div class="vault-stats">${kinds.map((k) => `<div class="vs k-${k}"><b>${active.filter((m) => m.kind === k).length}</b><span>${k}</span></div>`).join('')}</div>
    ${kinds.map((k) => { const rows = active.filter((m) => m.kind === k).reverse().map((m) => `<li><b>${esc(m.id)}</b> ${esc(m.text)}<div class="muted">${esc(m.date)}</div></li>`); return rows.length ? `<section class="panel"><div class="panel-h"><span class="tag k-${k}">${k.toUpperCase()}</span><span class="muted">${rows.length}</span></div><ul class="list">${capped(rows)}</ul></section>` : ''; }).join('')}`;

  // ── Log ────────────────────────────────────────────
  const logRows = log.slice().reverse().map((e) => `<li><span class="t">${esc(e.at)}</span> <b>${esc(e.agent || '·')}</b> ${esc(e.event.replace(/_/g, ' '))} ${esc(e.id || '')}${e.text ? ` <span class="muted">— ${esc(String(e.text).slice(0, 120))}</span>` : ''}</li>`);
  const msgRows = openMsgs.slice().reverse().map((m) => `<li>${chip(m.kind)} <b>#${m.id}</b> ${esc(m.from)} → ${esc(m.to)}: ${esc(m.text)}</li>`);
  const logPane = `<section class="panel"><div class="panel-h"><span class="tag">OPEN MESSAGES</span><span class="muted">${msgRows.length}</span></div><ul class="list">${capped(msgRows) || '<li class="muted">None.</li>'}</ul></section>
    <section class="panel"><div class="panel-h"><span class="tag">BATTLE LOG</span><span class="muted">${logRows.length} events</span></div><ul class="feed full">${capped(logRows)}</ul></section>`;

  const tabs = [['command', 'Command', command], ['quests', 'Quests', quests], ['party', 'Party', `<div class="party">${party}</div>`], ['vault', 'Memory', vault], ['log', 'Log', logPane]];

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>War room · ${esc(cfg.project)}</title>
<style>
:root{--bg:#07070b;--panel:#111119;--panel2:#171722;--edge:#272736;--text:#eeeef6;--muted:#7d7d8c;--v:#8058d4;--v2:#b49cff;--gold:#f5c451;--good:#4ade80;--hot:#ff6b6b;--cyan:#5ad7ff}
*{box-sizing:border-box}html{background:var(--bg)}
body{margin:0;color:var(--text);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px;max-width:1180px;margin-inline:auto;
 background:radial-gradient(900px 500px at 10% -10%,#8058d422,transparent 60%),radial-gradient(700px 400px at 100% 0,#5ad7ff12,transparent 60%),var(--bg);min-height:100vh}
body::before{content:"";position:fixed;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,#ffffff04 0 1px,transparent 1px 3px);z-index:9}
.mono,.tag,.k,.lv,.t,.state,.rank-l{font-family:ui-monospace,"SF Mono",Menlo,monospace}
.hud{display:grid;grid-template-columns:auto 1fr auto;gap:16px;align-items:center;background:linear-gradient(135deg,#1a1430,#101018);border:1px solid #3a2d66;border-radius:18px;padding:16px 18px;box-shadow:0 0 0 1px #8058d422 inset,0 10px 40px #8058d422}
.crest{width:64px;height:64px;border-radius:14px;display:grid;place-items:center;background:radial-gradient(circle at 50% 30%,#b49cff,#5b3aa8);box-shadow:0 0 24px #8058d4aa;position:relative}
.rank{font-size:30px;font-weight:900;color:#fff;text-shadow:0 2px 8px #0008;line-height:1}.rank-l{position:absolute;bottom:4px;font-size:8px;letter-spacing:.2em;color:#ffffffbb}
.title{font-size:12px;letter-spacing:.24em;color:var(--v2);font-weight:700}.title span{color:var(--muted)}
.lvline{display:flex;justify-content:space-between;gap:8px;margin:6px 0 4px;font-size:13px;flex-wrap:wrap}.lvline b{letter-spacing:.06em}.lvline span{color:var(--muted);font-size:12px}
.streak{text-align:center;min-width:64px}.flame{font-size:24px;line-height:1}.streak b{display:block;font-size:20px}.streak span{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em}
.bar{height:10px;background:#0b0b12;border:1px solid var(--edge);border-radius:999px;overflow:hidden}
.bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--v),var(--v2));box-shadow:0 0 12px #8058d4cc;transition:width .8s cubic-bezier(.2,.8,.2,1)}
.bar.xp{height:12px}.bar.xp i{background:linear-gradient(90deg,var(--gold),#ffe08a);box-shadow:0 0 14px #f5c45199}
.bar.boss{height:16px}.bar.boss i{background:linear-gradient(90deg,#ff6b6b,#ffb36b,var(--gold))}
.bar.cleared i{background:var(--good);box-shadow:0 0 10px #4ade8088}.bar.hp i{background:linear-gradient(90deg,#22c55e,#86efac)}
.tiles{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:14px 0}
.tile{background:var(--panel);border:1px solid var(--edge);border-radius:14px;padding:12px;position:relative;overflow:hidden}
.tile::after{content:"";position:absolute;inset:auto -20% -60% auto;width:90px;height:90px;border-radius:50%;background:#8058d41a}
.tile .k{display:block;font-size:10px;letter-spacing:.18em;color:var(--muted)}.tile b{display:block;font-size:26px;font-weight:800;margin:2px 0;letter-spacing:-.01em}.tile .sub{font-size:11px;color:var(--muted)}
.tile.alert{border-color:#ff6b6b88;box-shadow:0 0 18px #ff6b6b33}.tile.alert b{color:var(--hot)}
nav{display:flex;gap:4px;padding:4px;background:var(--panel);border:1px solid var(--edge);border-radius:14px;position:sticky;top:8px;z-index:5;margin-bottom:14px;overflow-x:auto}
nav button{flex:1;background:none;border:0;color:var(--muted);padding:9px 14px;border-radius:10px;font:600 12px ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;cursor:pointer;white-space:nowrap}
nav button.on{background:linear-gradient(135deg,#8058d4,#5b3aa8);color:#fff;box-shadow:0 0 16px #8058d466}
.grid{display:grid;grid-template-columns:1.35fr 1fr;gap:14px}.col{min-width:0}
.panel{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--edge);border-radius:16px;padding:14px 16px;margin-bottom:14px}
.panel-h{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}
.panel h2{font-size:18px;margin:2px 0 10px;letter-spacing:.01em}
.tag{font-size:10px;letter-spacing:.2em;color:var(--v2);font-weight:700}.tag.hot{color:var(--hot)}
.boss{border-color:#ff6b6b44;background:linear-gradient(160deg,#2a1420,var(--panel) 60%)}
.bossbar{display:flex;align-items:center;gap:10px}.bossbar .bar{flex:1}.bossbar span{font-size:12px;color:var(--muted);white-space:nowrap}
.meta{margin-top:8px;font-size:12px;color:var(--gold)}
.chip{font:600 9px ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.12em;padding:3px 8px;border-radius:999px;border:1px solid var(--edge);color:var(--muted)}
.s-active,.s-verified,.s-approved{color:var(--good);border-color:#4ade8066}.s-reported,.s-claimed,.s-judged,.s-intake,.s-handoff{color:var(--gold);border-color:#f5c45166}.s-conflict,.s-rejected{color:var(--hot);border-color:#ff6b6b66}
ul.list,ul.daily,ul.feed,ul.checks,ol.map{list-style:none;margin:0;padding:0}
ul.list li{padding:9px 0;border-top:1px solid var(--edge)}ul.list li:first-child{border-top:0}
ul.daily li{display:flex;align-items:center;gap:10px;padding:8px 10px;margin:6px 0;background:#0c0c13;border:1px solid var(--edge);border-radius:10px}
ul.daily .box{width:18px;height:18px;flex:none;border:2px solid var(--v);border-radius:5px;display:grid;place-items:center;font-size:11px;color:#0b0b0f}
ul.daily .done .box{background:var(--good);border-color:var(--good)}ul.daily .done{color:var(--muted);text-decoration:line-through}
ul.daily em{margin-left:auto;font:600 10px ui-monospace,Menlo,monospace;color:var(--gold);font-style:normal;white-space:nowrap}
.sum{display:flex;gap:10px}.sum .ic{font-size:18px}
ul.feed li{padding:5px 0;font-size:12.5px;border-left:2px solid var(--edge);padding-left:10px;margin-left:4px}ul.feed .t{color:var(--cyan);font-size:11px;margin-right:6px}
ol.map{position:relative}ol.map::before{content:"";position:absolute;left:17px;top:18px;bottom:18px;width:2px;background:linear-gradient(var(--v),var(--edge))}
.node{display:flex;gap:12px;padding:8px 0;position:relative}
.orb{width:36px;height:36px;flex:none;border-radius:50%;display:grid;place-items:center;font-weight:800;background:#0c0c13;border:2px solid var(--edge);color:var(--muted);z-index:1}
.node.cleared .orb{background:var(--good);border-color:var(--good);color:#06240f;box-shadow:0 0 14px #4ade8088}
.node.current .orb{background:radial-gradient(circle,#b49cff,#5b3aa8);border-color:var(--v2);color:#fff;box-shadow:0 0 0 4px #8058d433,0 0 18px #8058d4;animation:pulse 2s infinite}
.node.locked{opacity:.55}.node-body{flex:1;min-width:0}
.node-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px;font-size:13.5px}.lv{font-size:10px;color:var(--v2);letter-spacing:.14em}
.here{font:700 9px ui-monospace,Menlo,monospace;color:var(--gold);letter-spacing:.14em}
ul.checks li{font-size:12.5px;padding:2px 0;color:var(--muted)}ul.checks li.ok{color:var(--good)}
details summary{cursor:pointer;color:var(--muted);font-size:12px;padding:5px 0;list-style:none}details summary::before{content:"▸ ";color:var(--v2)}details[open] summary::before{content:"▾ "}
.ach{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.badge{border:1px solid var(--edge);border-radius:12px;padding:10px 6px;text-align:center;background:#0c0c13;filter:grayscale(1);opacity:.4}
.badge.got{filter:none;opacity:1;border-color:#f5c45166;box-shadow:0 0 14px #f5c45122;background:linear-gradient(180deg,#221c0c,#0c0c13)}
.badge span{font-size:22px;display:block}.badge b{display:block;font-size:11px;margin-top:3px}.badge em{display:block;font-size:9.5px;color:var(--muted);font-style:normal;line-height:1.3}
.party{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.member{display:flex;gap:12px;align-items:flex-start}.avatar{width:46px;height:46px;flex:none;border-radius:12px;display:grid;place-items:center;font-weight:900;background:linear-gradient(135deg,#2a2440,#141420);border:1px solid var(--edge)}
.m-body{flex:1;min-width:0}.m-body .bar{margin:8px 0 4px}.state{font-size:9.5px;letter-spacing:.16em;color:var(--muted)}
.member.fighting .avatar{border-color:var(--gold);box-shadow:0 0 14px #f5c45155}.member.fighting .state{color:var(--gold)}
.member.returning .state{color:var(--cyan)}.member.wounded .state{color:var(--hot)}.member.idle{opacity:.7}
.verdict{font-size:12.5px;margin:-4px 0 10px;color:var(--muted)}.verdict b{color:var(--gold);text-transform:uppercase}
.vault-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px}
.vs{background:var(--panel);border:1px solid var(--edge);border-radius:14px;padding:12px;text-align:center}.vs b{font-size:24px;display:block}.vs span{font:600 10px ui-monospace,Menlo,monospace;letter-spacing:.16em;color:var(--muted);text-transform:uppercase}
.k-rule b,.tag.k-rule{color:var(--hot)}.k-never b,.tag.k-never{color:#ff9f6b}.k-decision b,.tag.k-decision{color:var(--gold)}.k-pref b,.tag.k-pref{color:var(--v2)}.k-fact b,.tag.k-fact{color:var(--cyan)}
.muted{color:var(--muted);font-size:12px}code{background:#0b0b12;border:1px solid var(--edge);border-radius:6px;padding:1px 5px;font-size:11px}
.foot{color:var(--muted);font-size:11px;text-align:center;margin:18px 0 6px}
.pane{display:none}.pane.on{display:block;animation:in .25s ease}
@keyframes pulse{50%{box-shadow:0 0 0 7px #8058d411,0 0 26px #8058d4}}@keyframes in{from{opacity:0;transform:translateY(4px)}}
@media (max-width:900px){.grid{grid-template-columns:1fr}.tiles{grid-template-columns:repeat(3,1fr)}}
@media (max-width:520px){body{padding:12px}.hud{grid-template-columns:auto 1fr;padding:14px}.streak{grid-column:1/-1;display:flex;align-items:center;gap:8px;text-align:left}.streak b{display:inline;font-size:16px}
 .tiles{grid-template-columns:repeat(2,1fr)}.tile b{font-size:22px}.ach{grid-template-columns:repeat(2,1fr)}.vault-stats{grid-template-columns:repeat(3,1fr)}nav button{padding:9px 10px;font-size:11px}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style></head><body>
${hud}
<div class="tiles">${tiles}</div>
<nav>${tabs.map(([id, label], i) => `<button data-t="${id}" class="${i === 0 ? 'on' : ''}">${label}</button>`).join('')}</nav>
${tabs.map(([id, , body], i) => `<div class="pane ${i === 0 ? 'on' : ''}" id="${id}">${body}</div>`).join('')}
<div class="foot mono">commander: ${esc(cfg.commander)} · snapshot ${esc(now())} · XP comes only from verified work · <code>war-room dashboard</code> to refresh</div>
<script>
const tabs=document.querySelectorAll('nav button');
function show(id){tabs.forEach(b=>b.classList.toggle('on',b.dataset.t===id));document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('on',p.id===id));try{localStorage.setItem('wr-tab',id)}catch{}}
tabs.forEach(b=>b.onclick=()=>show(b.dataset.t));
try{const t=localStorage.getItem('wr-tab');if(t&&document.getElementById(t))show(t)}catch{}
</script>
</body></html>`;
}
