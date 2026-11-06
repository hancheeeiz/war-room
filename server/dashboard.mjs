// War room page rendered from the store. Main tab = what matters today; Details tab = everything else.
// Works as a plain file (answers become copyable commands) or through `war-room serve` (answers save instantly).
import { starterRules } from './starter-rules.mjs';
import { now } from './store.mjs';
import { recipes, runStatus, stoppedWorkers } from './agents.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

// Cap a list at `max` visible rows; the rest folds behind "show more".
function capped(rows, max = 10) {
  if (rows.length <= max) return rows.join('');
  return `${rows.slice(0, max).join('')}<details class="more"><summary>Show ${rows.length - max} more</summary>${rows.slice(max).join('')}</details>`;
}

function levelRows(g) {
  return (g.milestones || []).map((m, i) => {
    const done = m.checks.filter((c) => c.verified).length;
    const p = pct(done, m.checks.length);
    return `<div class="lv ${p === 100 ? 'won' : ''}"><span class="lv-id">L${i + 1}</span><div class="xp"><span style="width:${p}%"></span><em>${esc(m.title)}</em></div><span class="lv-n">${done}/${m.checks.length}</span></div>`;
  }).join('');
}

function eventText(e) {
  const what = e.event.replace(/_/g, ' ');
  const extra = e.text || e.title || e.reason || e.to ? ` — ${String(e.text || e.title || e.reason || `to ${e.to}`).slice(0, 140)}` : '';
  return `${what} ${e.id || ''}${extra}`;
}

export function renderDashboard(store, { live = false } = {}) {
  const cfg = store.config();
  const goals = store.read('goals').filter((g) => g.status !== 'dropped');
  const tasks = store.read('tasks');
  const messages = store.read('messages');
  const memory = store.read('memory');
  const log = store.readLog(100000).reverse();
  const today = now().slice(0, 10);
  const main = goals.find((g) => g.status === 'active') || goals[0];
  const questions = memory.filter((m) => m.kind === 'question' && m.status === 'active');
  const reports = tasks.filter((t) => t.status === 'reported');
  const runs = store.read('runs');
  const running = runs.filter((r) => runStatus(r) === 'running');
  const working = new Set([...tasks.filter((t) => t.status === 'claimed').map((t) => t.agent), ...running.map((r) => r.name)]);
  const debates = store.read('debates');
  const approvals = store.read('approvals').filter((x) => x.status === 'pending');
  const judged = goals.filter((g) => g.status === 'judged');
  const toApprove = approvals.length + judged.length;

  // ── MAIN TAB ─────────────────────────────────────────
  let goalPanel = '<section class="card"><h2>Main goal</h2><p class="note">No goal yet. Start one with <code>/war-room your goal</code>.</p></section>';
  let todayPanel = '<section class="card"><h2>Today</h2><p class="note">No daily goals set yet.</p></section>';
  let goalPct = 0;
  let todayDone = 0;
  let todayTotal = 0;
  if (main) {
    const checks = (main.milestones || []).flatMap((m) => m.checks);
    const done = checks.filter((c) => c.verified).length;
    goalPct = pct(done, checks.length);
    const items = (main.daily?.[today] || []).map((it) => {
      const t = tasks.find((x) => x.id === it.taskId);
      return { text: it.text, ok: t ? t.status === 'verified' : !!it.done };
    });
    todayTotal = items.length;
    todayDone = items.filter((i) => i.ok).length;
    goalPanel = `<section class="hud goal-panel">
      <div class="panel-k">Main goal</div>
      <div class="boss-top"><span class="boss-name">${esc(main.title)}</span>${main.intake?.byWhen ? `<span class="boss-cd">⏳ ${esc(main.intake.byWhen)}</span>` : ''}</div>
      <div class="hp"><span style="width:${goalPct}%"></span></div>
      <div class="boss-sub">${goalPct}% · ${done} of ${checks.length} checks verified</div>
      <div class="panel-k" style="margin-top:20px">Milestones</div>
      ${levelRows(main) || '<p class="boss-sub">No plan yet.</p>'}
    </section>`;
    todayPanel = `<section class="card today-panel"><div class="card-h"><h2>Today</h2><span class="meta">${todayDone}/${todayTotal} done</span></div>
      <ul class="daily">${items.map((i) => `<li class="${i.ok ? 'ok' : ''}"><span class="box">${i.ok ? '✓' : ''}</span><span>${esc(i.text)}</span></li>`).join('') || '<li class="none">No daily goals set yet.</li>'}</ul></section>`;
  }

  // ── The team chart: you → commander → each team member, with what each is doing right now ──
  const team = store.read('team');
  const stopped = new Set(stoppedWorkers(store).map((r) => r.name));
  const names = [...new Set([...team.map((m) => m.name), ...tasks.map((t) => t.agent).filter((a) => a && a !== cfg.commander)])];
  const company = (agent) => recipes()[agent]?.company || '';
  const memberState = (name) => {
    const ts = tasks.filter((t) => t.agent === name);
    const open = ts.find((t) => ['claimed', 'open', 'rejected', 'reported'].includes(t.status));
    const run = runs.filter((r) => r.name === name).pop();
    if (run && runStatus(run) === 'running') return ['working', 'Working', open];
    if (open?.status === 'reported') return ['check', 'Done, being checked', open];
    if (open?.status === 'claimed') return ['working', 'Working on it', open];
    if (stopped.has(name)) return ['stopped', 'Stopped — the commander looks at why', open];
    if (open?.status === 'open' && open.after && tasks.find((t) => t.id === open.after)?.status !== 'verified') return ['wait', `Waits for step ${open.after}`, open];
    if (open) return ['ready', 'Has work, not started', open];
    if (ts.length && ts.every((t) => t.status === 'verified')) return ['done', 'All done', null];
    return ['idle', 'Free', null];
  };
  const nodes = names.map((name) => {
    const m = team.find((x) => x.name === name) || { name, role: 'Helper chat' };
    const [state, label, task] = memberState(name);
    const run = runs.filter((r) => r.name === name).pop();
    const use = m.use || run?.agent || 'claude';
    const done = tasks.filter((t) => t.agent === name && t.status === 'verified').length;
    return `<button type="button" class="node s-${state}" data-to="${esc(name)}" title="Talk to ${esc(m.role)}">
      <span class="n-role">${esc(m.role)}</span><span class="n-name">${esc(name)} · ${esc(use)}${m.model || run?.model ? ` ${esc(m.model || run.model)}` : ''}<i>${esc(company(use))}</i></span>
      <span class="n-state"><span class="dot"></span>${esc(label)}</span>
      ${task ? `<span class="n-task">${task.after ? `<b>${esc(task.id)}</b> after ${esc(task.after)} · ` : `<b>${esc(task.id)}</b> · `}${esc(task.title)}</span>` : m.does ? `<span class="n-task">${esc(m.does)}</span>` : ''}
      <span class="n-foot">${done} done</span></button>`;
  }).join('');
  const cmdRun = runs.filter((r) => r.name === cfg.commander).pop();
  const cmdBusy = cmdRun && runStatus(cmdRun) === 'running';
  const board = `<section class="card board-card"><div class="card-h"><h2>Your team</h2><span class="meta">${working.size} working · ${names.length} member${names.length === 1 ? '' : 's'}</span></div>
    <p class="why">You only talk to the commander. It picks who does each job, checks the work, and tells you when something needs your yes. Tap anyone to talk to them directly.</p>
    <div class="org">
      <div class="tier"><div class="node me"><span class="n-role">You</span><span class="n-name">the founder</span></div></div>
      <div class="tier"><button type="button" class="node boss ${cmdBusy ? 's-working' : ''}" data-to="commander"><span class="n-role">Commander</span><span class="n-name">${esc(cfg.commander)} · plans, hands out work, checks it</span><span class="n-state"><span class="dot"></span>${cmdBusy ? 'Reading your message and routing it' : questions.length ? `Waiting on you (${questions.length} question${questions.length > 1 ? 's' : ''})` : reports.length ? `${reports.length} report${reports.length > 1 ? 's' : ''} to check` : 'Ready'}</span></button></div>
      ${nodes ? `<div class="tier team">${nodes}</div>` : '<p class="note center">No team yet. Tell the commander your goal; it hires the roles it needs (designer, backend, reviewer…) and they show up here.</p>'}
    </div>
    <p class="note">Step-by-step work shows as <b>t2 after t1</b>: the next member starts by itself once the step before is checked.</p></section>`;

  // ── One box to talk: to the commander (default), answering one of its questions, or to one team member ──
  const qChips = questions.map((q) => {
    const m = q.text.match(/^(.*) \(suggested: (.*)\)$/s);
    return `<div class="ask" data-q="${esc(q.id)}" data-sug="${esc(m ? m[2] : '')}"><span class="ask-k">Commander asks</span><span class="ask-t">${esc(m ? m[1] : q.text)}</span>${m ? `<span class="ask-s">Suggested: ${esc(m[2])}</span>` : ''}<span class="ask-go">Answer →</span></div>`;
  }).join('');
  const talk = `<section class="card talk"><div class="card-h"><h2>Tell the commander</h2></div>
    ${qChips ? `<div class="asks">${qChips}</div>` : ''}
    <div class="to-row"><span class="to-k">To</span><span id="toLabel" class="to-v">Commander</span><button type="button" class="link small" id="toReset" hidden>back to commander</button></div>
    <textarea id="say" placeholder="Anything in your own words: a goal, an idea, a change of mind, a worry."></textarea>
    <div class="row"><button class="send" type="button" id="sayBtn">Send</button><span class="note out" id="sayOut"></span></div>
    <p class="why">It starts working on it in the background right away — you do not need to open a chat.</p></section>`;

  const recent = log.slice(0, 5).map((e) => `<div class="item"><div class="plain">${esc(eventText(e))}</div><div class="meta">${esc(e.at)} · ${esc(e.agent || 'war room')}</div></div>`).join('');
  const recentCard = `<section class="card"><div class="card-h"><h2>Recent</h2><span class="meta">last 5</span></div>${recent || '<p class="note">Nothing yet.</p>'}<button class="link" type="button" data-go="details">See everything in Details →</button></section>`;

  const approvalCards = [
    ...approvals.map((x) => `<div class="ap" data-ap="${esc(x.id)}">
      <div class="ap-main"><div class="qt">${esc(x.action)}</div><div class="note" style="margin:2px 0 0">${esc(x.why || '')}</div>
      ${x.command ? `<div class="cmd"><span>Will run exactly:</span><code>${esc(x.command)}</code></div>` : ''}
      <div class="meta">${esc(x.id)} · asked by ${esc(x.agent)} · ${esc(x.asked)}</div></div>
      <div class="ap-btns"><button class="send" type="button" data-approve="${esc(x.id)}" data-yes="1">Approve</button><button class="ghost" type="button" data-approve="${esc(x.id)}" data-yes="0">Deny</button></div>
      <span class="note out"></span></div>`),
    ...judged.map((g) => `<div class="ap">
      <div class="ap-main"><div class="qt">Goal: ${esc(g.title)}</div>
      <div class="note" style="margin:2px 0 0">Commander recommends <b>${esc(g.verdict?.recommendation)}</b> — ${esc(g.verdict?.reason || '')}${g.verdict?.strongerVersion && g.verdict.strongerVersion !== 'none' ? `. Improved version: ${esc(g.verdict.strongerVersion)}` : ''}</div></div>
      <div class="ap-btns">${['keep', 'improve', 'later', 'drop'].map((c) => `<button class="${c === g.verdict?.recommendation ? 'send' : 'ghost'}" type="button" data-goal="${esc(g.id)}" data-choice="${c}">${c === 'improve' ? 'Improved' : c[0].toUpperCase() + c.slice(1)}</button>`).join('')}</div>
      <span class="note out"></span></div>`),
  ].join('');
  const approveCard = toApprove ? `<section class="card approve"><div class="card-h"><h2>Approve</h2><span class="pill warn">${toApprove}</span></div>${approvalCards}
    <p class="note">One approval covers that one action, once, for 30 minutes.</p></section>` : '';

  // Debates: every agent's final answer side by side, with the company behind it.
  const debateCard = (d, full) => {
    const last = d.results?.[d.results.length - 1] || [];
    const finals = d.finals || last.map((a) => ({ seat: a.seat, final: a.ok ? (a.final || '…') : a.text }));
    const seats = finals.length ? finals : d.seats.map((s) => ({ seat: s.seat, final: d.status === 'done' ? '' : 'thinking…' }));
    const rounds = full ? (d.results || []).map((round, i) => `<details class="ms"><summary><span class="tag">R${i + 1}</span>${i ? 'After reading the others' : 'Blind answers'}</summary>${round.map((a) => `<div class="item"><div class="meta">${esc(a.seat)} · ${esc(company(String(a.seat).split(':')[0]))}${a.ok ? '' : ' · failed'}</div><div class="plain pre">${esc(a.text)}</div></div>`).join('')}</details>`).join('') : '';
    return `<section class="card debate"><div class="card-h"><h2>Debate ${esc(d.id)} · ${esc(d.status)}</h2><span class="meta">${esc(d.created)}</span></div>
      <div class="goal">${esc(d.question)}</div>
      ${d.companies?.length < 2 ? '<p class="note">All seats are from one company, so agreement here is weak evidence.</p>' : ''}
      <div class="seats">${seats.map((f) => `<div class="hud-card ${d.status === 'running' ? 'working' : ''}"><div class="hud-who"><span class="dot"></span>${esc(f.seat)}<small>${esc(company(String(f.seat).split(':')[0]))}</small></div><div class="hud-last">${esc(f.final)}</div></div>`).join('')}</div>${rounds}</section>`;
  };
  const latestDebate = debates[debates.length - 1];
  const mainDebate = latestDebate && (latestDebate.status !== 'done' || String(latestDebate.finished || latestDebate.created).startsWith(today)) ? debateCard(latestDebate, false) : '';

  const mainPane = `${approveCard}
    <div class="grid g-main"><div class="col">${talk}${board}</div><div class="col">${goalPanel}${todayPanel}${recentCard}</div></div>
    ${mainDebate}`;

  // ── DETAILS TAB ─────────────────────────────────────
  const goalCards = goals.map((g) => `<section class="card"><h2>${g === main ? 'Main goal' : 'Goal'} · ${esc(g.status)}</h2>
    <div class="goal">${esc(g.title)}</div>
    ${g.verdict ? `<p class="note">Judged: ${esc(g.verdict.recommendation)} — ${esc(g.verdict.reason)}</p>` : ''}
    ${g.improved ? `<p class="note">Chosen improved version: ${esc(g.improved)}</p>` : ''}
    ${(g.milestones || []).map((m, i) => `<details class="ms"><summary><span class="tag">L${i + 1}</span>${esc(m.title)} <span class="meta">${m.checks.filter((c) => c.verified).length}/${m.checks.length}</span></summary>
      <p class="note">Win: ${esc(m.win)}</p><ul class="checks">${m.checks.map((c) => `<li class="${c.verified ? 'ok' : ''}">${c.verified ? '✓' : '○'} ${esc(c.text)}${c.evidence ? ` <span class="meta">— ${esc(c.evidence)}</span>` : ''}</li>`).join('')}</ul></details>`).join('')}
  </section>`).join('');

  const taskRows = tasks.slice().reverse().map((t) => `<div class="item"><div class="plain"><span class="tag">${esc(t.status)}</span>${esc(t.title)}</div><div class="meta">${esc(t.id)} · ${esc(t.agent)} · done when: ${esc(t.doneCheck)}</div></div>`);
  // Memory map: every kind as a region with its count; problems also grouped by the chat that hit them.
  const kinds = [['problem', 'Problems hit', 'bad'], ['idea', 'New ideas', 'accent'], ['todo', 'To do', 'warn'], ['decision', 'Decisions', 'warn'], ['rule', 'Rules', 'bad'], ['never', 'Never again', 'bad'], ['pref', 'Preferences', 'accent'], ['fact', 'Facts', 'ok']];
  const active = memory.filter((m) => m.status === 'active' && m.kind !== 'question');
  const row = (m) => `<div class="item"><div class="plain">${esc(m.text)}</div><div class="meta">${esc(m.id)} · ${esc(m.date)} · ${esc(m.source || '')}</div></div>`;
  const regions = kinds.map(([k, label, tone]) => `<a class="region t-${tone}" href="#mem-${k}"><b>${active.filter((m) => m.kind === k).length}</b><span>${label}</span></a>`).join('');
  const problems = active.filter((m) => m.kind === 'problem');
  const bySource = Object.create(null);
  for (const p of problems) (bySource[p.source || 'unknown'] ||= []).push(p);
  const problemMap = Object.entries(bySource).map(([src, ps]) => `<div class="hud-card"><div class="hud-who"><span class="dot bad"></span>${esc(src)}<small>${ps.length}</small></div><div class="hud-last">${esc(ps[ps.length - 1].text.slice(0, 110))}</div></div>`).join('');
  const memCards = kinds.map(([k, label]) => {
    const rows = active.filter((m) => m.kind === k).reverse().map(row);
    return rows.length ? `<details class="mem" id="mem-${k}"${k === 'problem' || k === 'idea' ? ' open' : ''}><summary>${label} <span class="meta">${rows.length}</span></summary>${capped(rows)}</details>` : '';
  }).join('');
  const memoryMap = `<section class="card"><h2>Memory map · ${active.length} kept, stored automatically</h2>
    <div class="regions">${regions}</div>
    ${problemMap ? `<h2 style="margin-top:16px">Problems by chat</h2><div class="party">${problemMap}</div>` : ''}
    <div style="margin-top:14px">${memCards || '<p class="note">Empty.</p>'}</div>
    <details class="mem" id="mem-starter"><summary>Starter rules (built in) <span class="meta">${starterRules().length}</span></summary>${starterRules().map((r) => `<div class="item"><div class="plain">${esc(r.text)}</div><div class="meta">${esc(r.id)} · built in</div></div>`).join('')}<p class="note">Add your own rule: tell the commander "new rule: …" in chat, then tap Approve here. Switch a built-in one off: <code>war-room rules --off s3 --yes</code></p></details></section>`;
  const msgRows = messages.filter((m) => m.open).reverse().map((m) => `<div class="item"><div class="plain"><span class="tag">${esc(m.kind)}</span>${esc(m.text)}</div><div class="meta">#${m.id} · ${esc(m.from)} → ${esc(m.to)} · ${esc(m.date)}</div></div>`);
  const logRows = log.map((e) => `<div class="item"><div class="plain">${esc(eventText(e))}</div><div class="meta">${esc(e.at)} · ${esc(e.agent || 'war room')}</div></div>`);

  const details = `
    <nav class="jump"><a href="#d-memory">Memory map</a><a href="#d-goals">Goals</a><a href="#d-tasks">Tasks</a><a href="#d-debates">Debates</a><a href="#d-msgs">Messages</a><a href="#d-log">Log</a></nav>
    <div id="d-memory">${memoryMap}</div>
    <div id="d-debates">${debates.slice().reverse().slice(0, 10).map((d) => debateCard(d, true)).join('') || '<section class="card"><h2>Debates</h2><p class="note">None yet. Ask the commander to put a question to several agents.</p></section>'}</div>
    <div class="grid g-2"><div class="col" id="d-goals">${goalCards || '<section class="card"><h2>Goals</h2><p class="note">None yet.</p></section>'}</div>
      <div class="col" id="d-tasks"><section class="card"><div class="card-h"><h2>Tasks</h2><span class="meta">${taskRows.length}</span></div>${capped(taskRows) || '<p class="note">None yet.</p>'}</section></div></div>
    <div class="grid g-2"><div class="col" id="d-msgs"><section class="card"><div class="card-h"><h2>Open messages</h2><span class="meta">${msgRows.length}</span></div>${capped(msgRows) || '<p class="note">None.</p>'}</section></div>
      <div class="col" id="d-log"><section class="card"><div class="card-h"><h2>Full log</h2><span class="meta">${logRows.length}</span></div>${capped(logRows) || '<p class="note">Nothing yet.</p>'}</section></div></div>`;

  const pills = [
    questions.length + toApprove ? `<span class="pill warn">${questions.length + toApprove} waiting on you</span>` : '<span class="pill ok">Nothing waits on you</span>',
    `<span class="pill ${working.size ? 'ok' : ''}">${working.size} chat${working.size === 1 ? '' : 's'} working</span>`,
    reports.length ? `<span class="pill">${reports.length} to check</span>` : '',
  ].join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>War room · ${esc(cfg.project)}</title>
<style>
:root{--bg:#0e0d12;--surface:#17151d;--surface2:#201d29;--ink:#eeeaf6;--muted:#a09bb0;--line:#2d2938;--accent:#a184f2;--accent-ink:#130c26;--ok:#5ac38a;--warn:#e2a64f;--bad:#f2766c;--font:"Geist",system-ui,-apple-system,sans-serif;--mono:"Geist Mono",ui-monospace,Menlo,monospace;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 var(--font);padding:18px 16px 48px}
.wrap{max-width:1120px;margin:0 auto;display:grid;gap:22px}
.top{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;padding-bottom:18px;border-bottom:1px solid var(--line)}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.2em;color:var(--accent);margin-bottom:4px}
.grid{display:grid;gap:18px;align-items:start}.col{display:grid;gap:18px;min-width:0}
.g-main{grid-template-columns:1.35fr 1fr}.g-desk{grid-template-columns:1.2fr 1fr}.g-2{grid-template-columns:1fr 1fr}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:grid;gap:2px}
.kpi-k{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600}
.kpi b{font-family:var(--mono);font-size:28px;font-weight:500;letter-spacing:-.02em;line-height:1.2}.kpi-s{font-size:12.5px;color:var(--muted)}
.kpi.t-accent b{color:var(--accent)}.kpi.t-ok b{color:var(--ok)}.kpi.t-warn{border-color:#e2a64f66}.kpi.t-warn b{color:var(--warn)}
.card-h{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px}.card-h h2{margin:0}
.panel-k{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#a99be0;font-weight:600;margin-bottom:10px}
.goal-panel{padding:18px 20px}.boss-name{font-size:16px;letter-spacing:.02em}
.approve{border-color:#e2a64f88;box-shadow:0 0 0 1px #e2a64f22 inset,0 8px 30px #e2a64f14}
.ap{display:grid;grid-template-columns:1fr auto;gap:10px 16px;align-items:center;padding:12px 0;border-top:1px solid var(--line)}.ap:first-of-type{border-top:0;padding-top:0}
.ap-btns{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.ap .out{grid-column:1/-1}
.cmd{margin:8px 0 4px;display:grid;gap:4px}.cmd span{font-size:12px;color:var(--warn);font-weight:600}.cmd code{display:block;white-space:pre-wrap;word-break:break-all;font-size:12.5px;padding:8px 10px;border:1px solid #e2a64f55}
.ghost{border:1px solid var(--line);background:var(--surface2);color:var(--ink);border-radius:10px;padding:9px 14px;font-weight:500}
@media (max-width:560px){.ap{grid-template-columns:1fr}.ap-btns{justify-content:stretch}.ap-btns button{flex:1;padding:12px}}
.divider{height:1px;background:var(--line);margin:16px 0}
.jump{display:flex;gap:6px;flex-wrap:wrap}.jump a{font-size:13px;color:var(--muted);text-decoration:none;padding:5px 12px;border-radius:999px;background:var(--surface);border:1px solid var(--line)}.jump a:hover{color:var(--ink)}
@media (max-width:860px){.g-main,.g-desk,.g-2{grid-template-columns:1fr}.kpis{grid-template-columns:repeat(2,1fr)}.top{align-items:flex-start}}
h1{font-size:22px;letter-spacing:-.01em;margin:0}
h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 10px;font-weight:600}
.sub,.meta{font-family:var(--mono);font-size:12px;color:var(--muted)}.sub{font-size:13px;margin-top:2px}
.pills{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.pill{font-size:12.5px;padding:3px 10px;border-radius:999px;background:var(--surface2);color:var(--muted);font-weight:500}.pill.ok{color:var(--ok)}.pill.warn{color:var(--warn)}
.tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;background:var(--surface);border:1px solid var(--line);border-radius:12px;min-width:240px}
@media (max-width:860px){.tabs{width:100%;position:sticky;top:8px;z-index:3}}
.tabs button{border:0;background:none;color:var(--muted);padding:9px;border-radius:9px;font-weight:600}
.tabs button.on{background:var(--accent);color:var(--accent-ink)}
.how{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.how li{display:flex;gap:10px;align-items:flex-start;font-size:13.5px;color:var(--muted);background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 12px}.how b{flex:none;width:22px;height:22px;border-radius:50%;background:var(--surface2);color:var(--accent);display:grid;place-items:center;font-family:var(--mono);font-size:12px}
@media (max-width:860px){.how{grid-template-columns:1fr;gap:6px}.how li{padding:7px 10px;font-size:12.5px}}
.why{color:var(--muted);font-size:13px;margin:0 0 12px}.talk .why{margin:10px 0 0}
.asks{display:grid;gap:8px;margin-bottom:12px}
.ask{display:grid;gap:2px;text-align:left;border:1px solid #e2a64f55;background:#e2a64f0d;border-radius:10px;padding:9px 12px;cursor:pointer}.ask.on{border-color:var(--warn);box-shadow:0 0 0 1px var(--warn) inset}
.ask-k{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--warn);font-weight:600}.ask-t{font-weight:600}.ask-s{font-size:12.5px;color:var(--muted)}.ask-go{font-size:12.5px;color:var(--accent)}
.to-row{display:flex;gap:8px;align-items:baseline;margin-bottom:6px;font-size:13px}.to-k{color:var(--muted)}.to-v{font-weight:600;color:var(--accent)}.link.small{padding:0;font-size:12.5px}
.talk textarea{min-height:84px}
.org{display:grid;gap:22px;position:relative}
.tier{display:flex;justify-content:center;flex-wrap:wrap;gap:10px;position:relative}
.tier+.tier::before{content:"";position:absolute;top:-22px;left:50%;height:22px;border-left:1px dashed #3a2f66}
.tier.team{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));border-top:1px dashed #3a2f66;padding-top:14px}
.node{font:inherit;color:var(--ink);text-align:left;display:grid;gap:3px;min-width:0;border:1px solid #3a2f66;background:#17142a;border-radius:10px;padding:10px 12px;cursor:pointer}
.node:hover{border-color:var(--accent)}.node.me{cursor:default;background:var(--surface2);border-color:var(--line);text-align:center;min-width:160px}
.node.boss{min-width:260px;max-width:420px;border-color:var(--accent);background:linear-gradient(160deg,#211a3d,#17142a)}
.n-role{font-weight:600}.n-name{font-family:var(--mono);font-size:11.5px;color:var(--muted);overflow-wrap:anywhere}.n-name i{font-style:normal;margin-left:6px;color:#a99be0}
.n-state{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--muted)}.n-task{font-size:12.5px;color:var(--ink);overflow-wrap:anywhere}.n-task b{font-family:var(--mono);font-weight:500;color:var(--accent)}.n-foot{font-size:11px;color:var(--muted);font-family:var(--mono)}
.s-working{border-color:var(--ok)}.s-working .dot{background:var(--ok);box-shadow:0 0 8px var(--ok);animation:pulse 1.4s infinite}.s-working .n-state{color:var(--ok)}
.s-check .dot,.s-ready .dot{background:var(--warn)}.s-check .n-state{color:var(--warn)}.s-stopped{border-color:#f2766c88}.s-stopped .dot{background:var(--bad)}.s-stopped .n-state{color:var(--bad)}
.s-wait .dot{background:#6b6580}.s-done .dot{background:var(--ok)}.center{text-align:center}
.pane{display:none;gap:18px}.pane.on{display:grid}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px 18px;min-width:0}
.q{display:grid;gap:8px}.q+.q{margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
.qt{font-weight:600;overflow-wrap:anywhere}
.quick{display:flex;flex-wrap:wrap;gap:6px}
button{font:inherit;cursor:pointer}
.quick button{border:1px solid var(--line);background:var(--surface2);color:var(--ink);border-radius:999px;padding:6px 13px;font-weight:500}
textarea{width:100%;font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:9px 10px;resize:vertical;min-height:60px}
button:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.send{border:0;background:var(--accent);color:var(--accent-ink);border-radius:10px;padding:9px 18px;font-weight:600}.send:disabled{opacity:.5}
.link{border:0;background:none;color:var(--accent);padding:10px 0 0;font-weight:500}
.note{color:var(--muted);font-size:13px;margin:8px 0 0}.out{margin:0}.out.ok{color:var(--ok)}.out.bad{color:var(--bad)}
.empty{color:var(--ok);font-weight:600;margin:0}
.goal{font-size:15px;font-weight:600;overflow-wrap:anywhere}
.item{display:grid;gap:2px;padding:9px 0;border-top:1px solid var(--line)}.item:first-of-type{border-top:0;padding-top:0}
.plain{overflow-wrap:anywhere}
.tag{display:inline-block;font-family:var(--mono);font-size:11.5px;padding:1px 7px;border-radius:6px;background:var(--surface2);color:var(--accent);margin-right:6px}
code{font-family:var(--mono);font-size:12px;background:var(--surface2);padding:1px 6px;border-radius:6px}
details summary{cursor:pointer;list-style:none}details summary::-webkit-details-marker{display:none}
details.more summary{color:var(--accent);padding:10px 0 2px;font-size:13.5px}
details.mem{border-top:1px solid var(--line);padding:10px 0}details.mem:first-of-type{border-top:0;padding-top:0}details.mem summary{font-weight:600}details.mem[open] summary{margin-bottom:8px}
details.ms{padding:8px 0;border-top:1px solid var(--line)}details.ms summary{font-size:14px}
ul.checks{list-style:none;margin:6px 0 0;padding:0;font-size:13.5px;color:var(--muted)}ul.checks li{padding:2px 0}ul.checks li.ok{color:var(--ok)}
/* Game HUD: boss bar, level bars, chat cards. */
.hud{background:linear-gradient(160deg,#17122b,#0e0d16 70%);border:1px solid #3a2f66;border-radius:14px;padding:14px 15px;font-family:var(--mono);box-shadow:0 0 22px rgba(125,88,230,.18);min-width:0}
.hud h3{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#a99be0;margin:16px 0 8px;font-weight:600}
.boss-top{display:flex;justify-content:space-between;gap:8px;font-size:13px;letter-spacing:.06em;font-weight:600}.boss-cd{color:#ffb454;white-space:nowrap}
.hp{height:18px;border:2px solid #5a1f2a;background:#240a10;border-radius:4px;overflow:hidden;margin:8px 0 6px}.hp span{display:block;height:100%;background:repeating-linear-gradient(90deg,#e0384f 0 10px,#b82a3e 10px 12px);transition:width .6s}
.boss-sub{font-size:12px;color:var(--muted)}
ul.daily{list-style:none;margin:0;padding:0;font-family:var(--font);font-size:14px}
ul.daily li{display:flex;gap:10px;align-items:flex-start;padding:6px 0}ul.daily li.ok{color:var(--muted);text-decoration:line-through}ul.daily li.none{color:var(--muted);font-size:13px}
.box{width:18px;height:18px;flex:none;margin-top:2px;border:2px solid var(--accent);border-radius:5px;display:grid;place-items:center;font-size:11px;color:var(--accent-ink);text-decoration:none}li.ok .box{background:var(--ok);border-color:var(--ok)}
.lv{display:grid;grid-template-columns:26px 1fr 40px;gap:8px;align-items:center;margin:6px 0;font-size:12px}.lv-id{color:#a99be0;font-weight:600}.lv-n{text-align:right;color:var(--muted);font-size:11px}
.xp{position:relative;height:20px;border:1px solid #3a2f66;background:#17142a;border-radius:3px;overflow:hidden}.xp span{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,#6d4fd1,#a184f2)}
.xp em{position:relative;display:block;padding:0 8px;line-height:18px;font-style:normal;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#eeeaf6}
.lv.won .xp span{background:linear-gradient(90deg,#1f8a54,#5ac38a)}.lv.won .lv-n{color:var(--ok)}
.party{display:grid;grid-template-columns:1fr 1fr;gap:8px}@media (max-width:420px){.party{grid-template-columns:1fr}}
.hud-card{border:1px solid #3a2f66;background:#17142a;border-radius:8px;padding:8px 10px;font-size:12px;min-width:0}.hud-card.working{border-color:var(--ok)}
.hud-who{font-weight:600;letter-spacing:.06em;display:flex;align-items:center;gap:6px}.hud-who small{margin-left:auto;font-weight:400;color:var(--muted);font-size:10.5px}
.dot{width:8px;height:8px;border-radius:50%;background:#6b6580;flex:none}.working .dot{background:var(--ok);box-shadow:0 0 8px var(--ok);animation:pulse 1.4s infinite}
.regions{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}
.region{display:grid;gap:2px;padding:10px 12px;border-radius:10px;background:var(--surface2);border:1px solid var(--line);color:var(--ink);text-decoration:none}
.region b{font-size:22px;font-family:var(--mono)}.region span{font-size:12px;color:var(--muted)}
.region.t-bad b{color:var(--bad)}.region.t-warn b{color:var(--warn)}.region.t-ok b{color:var(--ok)}.region.t-accent b{color:var(--accent)}
.dot.bad{background:var(--bad)}
.seats{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-top:12px}.pre{white-space:pre-wrap;font-size:13.5px}
.hud-do{margin-top:4px;color:#ffb454;overflow-wrap:anywhere}.hud-last{margin-top:4px;color:var(--muted);overflow-wrap:anywhere}
@keyframes pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style></head><body><div class="wrap">
<header class="top"><div><div class="eyebrow">WAR ROOM</div><h1>${esc(cfg.project)}</h1><div class="sub">${esc(now())}${live ? ' · live' : ' · snapshot'}</div><div class="pills">${pills}</div></div>
<nav class="tabs"><button type="button" class="on" data-go="main">Main</button><button type="button" data-go="details">Details</button></nav></header>
<ol class="how"><li><b>1</b>Tell the commander what you want, in any words.</li><li><b>2</b>It hands each job to the right team member and checks the work.</li><li><b>3</b>You only step in to answer a question or approve a risky step (push, deploy, money, deleting).</li></ol>
<div class="pane on" id="main">${mainPane}</div>
<div class="pane" id="details">${details}</div>
</div>
<script>
const LIVE=${live ? 'true' : 'false'};
const TOKEN=new URLSearchParams(location.search).get('t')||'';
function go(id){document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('on',p.id===id));document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.go===id));scrollTo(0,0);try{localStorage.setItem('wr-tab',id)}catch{}}
document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
try{const t=localStorage.getItem('wr-tab');if(t)go(t)}catch{}
document.querySelectorAll('[data-fill]').forEach(b=>b.onclick=()=>{b.closest('.q').querySelector('textarea').value=b.dataset.fill});
const shq=s=>"'"+s.replace(/'/g,"'\\\\''")+"'";
async function post(path,body,out,fallback){
  if(!LIVE){out.className='note out';out.textContent='Copy and run in a terminal (or open this page with war-room serve to send from here):';const c=document.createElement('code');c.textContent=fallback;out.append(document.createElement('br'),c);return false}
  try{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-war-room-token':TOKEN},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw new Error(j.error||'failed');out.className='note out ok';out.textContent='Saved. The commander has it now.';return true}
  catch(e){out.className='note out bad';out.textContent='Not saved: '+e.message;return false}}
// The one talk box: who it goes to is shown above it; tapping a team member or a question changes that.
const say=document.getElementById('say'),sayOut=document.getElementById('sayOut'),toLabel=document.getElementById('toLabel'),toReset=document.getElementById('toReset');
let target={};
function aim(t,label,hint){target=t;toLabel.textContent=label;toReset.hidden=!t.to&&!t.answer;say.placeholder=hint;document.querySelectorAll('.ask').forEach(a=>a.classList.toggle('on',a.dataset.q===t.answer));say.focus()}
toReset.onclick=()=>aim({},'Commander','Anything in your own words: a goal, an idea, a change of mind, a worry.');
document.querySelectorAll('.ask').forEach(a=>a.onclick=()=>{aim({answer:a.dataset.q},'Commander · answering '+a.dataset.q,'Your answer, any words.');if(a.dataset.sug&&!say.value)say.value=a.dataset.sug});
document.querySelectorAll('[data-to]').forEach(n=>n.onclick=()=>{const to=n.dataset.to;if(to==='commander')return toReset.onclick();aim({to},n.querySelector('.n-role').textContent+' ('+to+')','Message for '+to+' only. The commander still sees its report.');scrollTo({top:say.getBoundingClientRect().top+scrollY-120,behavior:'smooth'})});
document.getElementById('sayBtn').onclick=async e=>{const text=say.value.trim();if(!text){sayOut.className='note out bad';sayOut.textContent='Type something first.';return}
  e.target.disabled=true;const body={text,...target};
  const fallback=target.answer?'war-room answer --question '+target.answer+' --text '+shq(text):'war-room call post_message '+shq(JSON.stringify({agent:'founder',to:target.to||'commander',kind:'info',text}));
  if(await post('/api/say',body,sayOut,fallback)){say.value='';sayOut.textContent=target.to?'Sent to '+target.to+'. It starts on it in the background.':target.answer?'Answer saved. The commander carries on.':'Sent. The commander is on it in the background; the team chart shows who it hands the work to.';setTimeout(()=>location.reload(),2500)}
  e.target.disabled=false};
document.querySelectorAll('[data-approve]').forEach(b=>b.onclick=async()=>{const box=b.closest('.ap'),out=box.querySelector('.out'),yes=b.dataset.yes==='1';
  if(yes&&!confirm('Approve '+b.dataset.approve+'? It will run once.'))return;box.querySelectorAll('button').forEach(x=>x.disabled=true);
  if(await post('/api/approve',{id:b.dataset.approve,yes},out,'war-room approve --id '+b.dataset.approve+(yes?' --yes':' --no')))setTimeout(()=>location.reload(),900);else box.querySelectorAll('button').forEach(x=>x.disabled=false)});
document.querySelectorAll('[data-goal]').forEach(b=>b.onclick=async()=>{const box=b.closest('.ap'),out=box.querySelector('.out');box.querySelectorAll('button').forEach(x=>x.disabled=true);
  if(await post('/api/goal',{goalId:b.dataset.goal,choice:b.dataset.choice},out,'war-room call decide_goal '+shq(JSON.stringify({agent:'commander',goalId:b.dataset.goal,choice:b.dataset.choice,founderWords:'chose on the page'}))))setTimeout(()=>location.reload(),900);else box.querySelectorAll('button').forEach(x=>x.disabled=false)});
if(LIVE)setInterval(async()=>{try{const r=await fetch('/api/version',{headers:{'x-war-room-token':TOKEN}});const v=await r.text();if(window.__v&&v!==window.__v&&!document.activeElement.matches('textarea'))location.reload();window.__v=v}catch{}},5000);
</script></body></html>`;
}
