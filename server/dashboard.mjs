// Static HTML dashboard rendered from the store. No server, no dependencies: open the file.
import { now } from './store.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function bar(pct, label = '') {
  return `<div class="bar"><div class="fill" style="width:${pct}%"></div><span>${pct}%${label ? ` · ${esc(label)}` : ''}</span></div>`;
}

function chip(status) {
  return `<span class="chip s-${esc(status)}">${esc(status)}</span>`;
}

// Cap a list at `max` visible rows; the rest folds behind "show more".
function capped(rows, max = 10) {
  if (rows.length <= max) return rows.join('');
  return `${rows.slice(0, max).join('')}<details><summary>show ${rows.length - max} more</summary>${rows.slice(max).join('')}</details>`;
}

export function renderDashboard(store) {
  const cfg = store.config();
  const goals = store.read('goals').filter((g) => g.status !== 'dropped');
  const tasks = store.read('tasks');
  const messages = store.read('messages');
  const memory = store.read('memory');
  const log = store.readLog(100000).reverse();
  const today = now().slice(0, 10);

  const goalCards = goals.map((g) => {
    const checks = (g.milestones || []).flatMap((m) => m.checks || []);
    const pct = checks.length ? Math.round((checks.filter((c) => c.verified).length / checks.length) * 100) : 0;
    const ms = (g.milestones || []).map((m) => {
      const p = m.checks?.length ? Math.round((m.checks.filter((c) => c.verified).length / m.checks.length) * 100) : 0;
      return `<div class="ms"><div class="ms-head"><b>${esc(m.id)}</b> ${esc(m.title)}</div>${bar(p)}<div class="muted">win: ${esc(m.win)}</div></div>`;
    }).join('');
    const daily = (g.daily?.[today] || []).map((it) => {
      const t = tasks.find((x) => x.id === it.taskId);
      const done = t ? t.status === 'verified' : !!it.done;
      return `<li class="${done ? 'done' : ''}">${done ? '✦' : '○'} ${esc(it.text)}</li>`;
    }).join('');
    return `<section class="card lvl"><header><h2>⚔ ${esc(g.title)}</h2>${chip(g.status)}</header>${bar(pct, `${checks.filter((c) => c.verified).length}/${checks.length} checks verified`)}
      ${g.verdict ? `<p class="muted">judged: ${esc(g.verdict.recommendation)} — ${esc(g.verdict.reason)}</p>` : ''}
      ${daily ? `<h3>Today</h3><ul class="today">${daily}</ul>` : ''}
      ${ms ? `<h3>Levels</h3>${ms}` : '<p class="muted">No plan yet.</p>'}</section>`;
  }).join('') || '<section class="card"><p class="muted">No goals yet. Start one with /war-room.</p></section>';

  const byAgent = {};
  for (const t of tasks) (byAgent[t.agent] ||= []).push(t);
  const agentCards = Object.entries(byAgent).map(([agent, ts]) => {
    const open = ts.filter((t) => t.status !== 'verified');
    const rows = ts.slice().reverse().map((t) => `<li>${chip(t.status)} <b>${esc(t.id)}</b> ${esc(t.title)}${t.model ? ` <span class="muted">(${esc(t.model)} model)</span>` : ''}<div class="muted">done when: ${esc(t.doneCheck)}</div></li>`);
    return `<section class="card"><header><h2>🛡 ${esc(agent)}</h2><span class="muted">${open.length} open · ${ts.length - open.length} verified</span></header><ul class="list">${capped(rows, 5)}</ul></section>`;
  }).join('') || '<section class="card"><p class="muted">No chats have tasks yet.</p></section>';

  const questions = memory.filter((m) => m.kind === 'question' && m.status === 'active');
  const openMsgs = messages.filter((m) => m.open);
  const inbox = `<section class="card"><header><h2>❓ Waiting on you</h2></header><ul class="list">${capped(questions.map((q) => `<li><b>${esc(q.id)}</b> ${esc(q.text)}<div class="muted">${esc(q.date)} · answer: <code>war-room answer --question ${esc(q.id)} --text "..."</code></div></li>`)) || '<li class="muted">Nothing waits on you.</li>'}</ul></section>
  <section class="card"><header><h2>✉ Open messages</h2></header><ul class="list">${capped(openMsgs.slice().reverse().map((m) => `<li>${chip(m.kind)} <b>#${m.id}</b> ${esc(m.from)} → ${esc(m.to)}: ${esc(m.text)}<div class="muted">${esc(m.date)}</div></li>`)) || '<li class="muted">No open messages.</li>'}</ul></section>`;

  const memRows = memory.filter((m) => m.status === 'active' && m.kind !== 'question').slice().reverse()
    .map((m) => `<li>${chip(m.kind)} <b>${esc(m.id)}</b> ${esc(m.text)}<div class="muted">${esc(m.date)} · ${esc(m.source || '')}</div></li>`);
  const memoryCard = `<section class="card"><header><h2>🧠 Memory</h2><span class="muted">${memRows.length} active</span></header><ul class="list">${capped(memRows)}</ul></section>`;

  const logRows = log.map((e) => `<li><span class="muted">${esc(e.at)}</span> <b>${esc(e.agent || '')}</b> ${esc(e.event)} ${esc(e.id || '')}${e.text ? ` — ${esc(String(e.text).slice(0, 120))}` : ''}${e.reason ? ` — ${esc(e.reason)}` : ''}</li>`);
  const logCard = `<section class="card"><header><h2>📜 Log</h2><span class="muted">${logRows.length} events</span></header><ul class="list log">${capped(logRows)}</ul></section>`;

  const tabs = [['today', '⚔ Goals', goalCards], ['chats', '🛡 Chats', agentCards], ['inbox', '❓ Inbox', inbox], ['memory', '🧠 Memory', memoryCard], ['log', '📜 Log', logCard]];

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>War room · ${esc(cfg.project)}</title>
<style>
:root{--bg:#0b0b0f;--card:#15151d;--edge:#2a2a38;--text:#f2f2f7;--muted:#8a8a95;--accent:#8058d4;--accent2:#9d78f0;--good:#4ade80;--warn:#fbbf24}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;padding:16px;max-width:760px;margin-inline:auto}
h1{font-size:19px;margin:4px 0 2px;letter-spacing:.04em}h2{font-size:15px;margin:0;letter-spacing:.03em}h3{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;margin:14px 0 6px}
.sub{color:var(--muted);font-size:12px;margin-bottom:14px}
nav{display:flex;gap:6px;margin:12px 0;flex-wrap:wrap;position:sticky;top:0;background:var(--bg);padding:8px 0;z-index:2}
nav button{background:var(--card);border:1px solid var(--edge);color:var(--muted);padding:7px 12px;border-radius:999px;font:inherit;font-size:13px;cursor:pointer}
nav button.on{color:var(--text);border-color:var(--accent);box-shadow:0 0 12px #8058d455}
.card{background:var(--card);border:1px solid var(--edge);border-radius:14px;padding:14px 16px;margin-bottom:12px}
.card header{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}
.bar{position:relative;height:18px;background:#0e0e14;border:1px solid var(--edge);border-radius:999px;overflow:hidden;margin:6px 0}
.bar .fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));box-shadow:0 0 14px #8058d4aa;border-radius:999px;transition:width .6s}
.bar span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;text-shadow:0 1px 2px #000}
.chip{font-size:10px;text-transform:uppercase;letter-spacing:.08em;padding:3px 8px;border-radius:999px;border:1px solid var(--edge);color:var(--muted)}
.s-active,.s-verified,.s-approved{color:var(--good);border-color:var(--good)}
.s-reported,.s-claimed,.s-judged,.s-intake{color:var(--warn);border-color:var(--warn)}
.s-conflict,.s-rejected{color:#f87171;border-color:#f87171}
ul.list,ul.today{list-style:none;margin:0;padding:0}ul.list li{padding:8px 0;border-top:1px solid var(--edge)}ul.list li:first-child{border-top:0}
ul.today li{padding:4px 0}ul.today .done{color:var(--muted);text-decoration:line-through}
.muted{color:var(--muted);font-size:12px}.ms{margin:8px 0}.ms-head{font-size:13px}
details summary{color:var(--accent2);cursor:pointer;padding:8px 0;font-size:13px}
code{background:#0e0e14;border:1px solid var(--edge);border-radius:6px;padding:1px 5px;font-size:11px}
.pane{display:none}.pane.on{display:block}
</style></head><body>
<h1>⚔ WAR ROOM · ${esc(cfg.project)}</h1>
<div class="sub">commander: ${esc(cfg.commander)} · rendered ${esc(now())} · a snapshot, not live — re-run <code>war-room dashboard</code></div>
<nav>${tabs.map(([id, label], i) => `<button data-t="${id}" class="${i === 0 ? 'on' : ''}">${label}</button>`).join('')}</nav>
${tabs.map(([id, , body], i) => `<div class="pane ${i === 0 ? 'on' : ''}" id="${id}">${body}</div>`).join('')}
<script>document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button,.pane').forEach(x=>x.classList.remove('on'));b.classList.add('on');document.getElementById(b.dataset.t).classList.add('on')})</script>
</body></html>`;
}
