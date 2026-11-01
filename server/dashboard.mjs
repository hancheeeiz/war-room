// War room page rendered from the store. Main tab = what matters today; Details tab = everything else.
// Works as a plain file (answers become copyable commands) or through `war-room serve` (answers save instantly).
import { now } from './store.mjs';

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
  const working = new Set(tasks.filter((t) => t.status === 'claimed').map((t) => t.agent));

  // ── MAIN TAB ─────────────────────────────────────────
  let hud = '<section class="card"><p class="note">No goal yet. Start one with <code>/war-room your goal</code>.</p></section>';
  if (main) {
    const checks = (main.milestones || []).flatMap((m) => m.checks);
    const done = checks.filter((c) => c.verified).length;
    const daily = (main.daily?.[today] || []).map((it) => {
      const t = tasks.find((x) => x.id === it.taskId);
      const ok = t ? t.status === 'verified' : !!it.done;
      return `<li class="${ok ? 'ok' : ''}"><span class="box">${ok ? '✓' : ''}</span><span>${esc(it.text)}</span></li>`;
    }).join('');
    hud = `<section class="hud">
      <div class="boss-top"><span>${esc(main.title)}</span>${main.intake?.byWhen ? `<span class="boss-cd">${esc(main.intake.byWhen)}</span>` : ''}</div>
      <div class="hp"><span style="width:${pct(done, checks.length)}%"></span></div>
      <div class="boss-sub">${pct(done, checks.length)}% · ${done} of ${checks.length} checks verified</div>
      <h3>Today</h3>
      <ul class="daily">${daily || '<li class="none">No daily goals set yet.</li>'}</ul>
      <h3>Milestones</h3>
      ${levelRows(main) || '<p class="boss-sub">No plan yet.</p>'}
    </section>`;
  }

  const qCards = questions.map((q) => {
    const m = q.text.match(/^(.*) \(suggested: (.*)\)$/s);
    const ask = m ? m[1] : q.text;
    const suggested = m ? m[2] : '';
    return `<div class="q" data-q="${esc(q.id)}">
      <div class="qt">${esc(ask)}</div>
      <div class="meta">${esc(q.id)} · asked ${esc(q.date)} by ${esc(q.source)}</div>
      ${suggested ? `<div class="quick"><button type="button" data-fill="${esc(suggested)}">Suggested: ${esc(suggested)}</button></div>` : ''}
      <textarea placeholder="Your answer, any words"></textarea>
      <div class="row"><button class="send" type="button" data-answer="${esc(q.id)}">Send answer</button><span class="note out"></span></div>
    </div>`;
  }).join('');
  const needs = `<section class="card"><h2>Needs you</h2>
    ${qCards || '<p class="empty">Nothing waits on you.</p>'}
    ${reports.length ? `<p class="note">${reports.length} finished task${reports.length > 1 ? 's' : ''} waiting for the commander to check.</p>` : ''}
  </section>
  <section class="card"><h2>Tell the war room anything</h2>
    <div class="q"><textarea id="thought" placeholder="A new idea, a change of mind, a worry. Any words."></textarea>
    <div class="row"><button class="send" type="button" id="thoughtSend">Send</button><span class="note out"></span></div></div>
  </section>`;

  const recent = log.slice(0, 5).map((e) => `<div class="item"><div class="plain">${esc(eventText(e))}</div><div class="meta">${esc(e.at)} · ${esc(e.agent || 'war room')}</div></div>`).join('');
  const recentCard = `<section class="card"><h2>Recent</h2>${recent || '<p class="note">Nothing yet.</p>'}<button class="link" type="button" data-go="details">See everything in Details →</button></section>`;

  // ── DETAILS TAB ─────────────────────────────────────
  const agents = [...new Set(tasks.map((t) => t.agent))];
  const party = agents.map((a) => {
    const ts = tasks.filter((t) => t.agent === a);
    const live = ts.find((t) => t.status !== 'verified');
    return `<div class="hud-card ${working.has(a) ? 'working' : ''}"><div class="hud-who"><span class="dot"></span>${esc(a)}<small>${ts.filter((t) => t.status === 'verified').length}/${ts.length} done</small></div>
      <div class="${live ? 'hud-do' : 'hud-last'}">${live ? `${esc(live.status)} · ${esc(live.title)}` : 'Idle'}</div>${live?.model ? `<div class="hud-last">${esc(live.model)} model</div>` : ''}</div>`;
  }).join('');

  const goalCards = goals.map((g) => `<section class="card"><h2>${g === main ? 'Main goal' : 'Goal'} · ${esc(g.status)}</h2>
    <div class="goal">${esc(g.title)}</div>
    ${g.verdict ? `<p class="note">Judged: ${esc(g.verdict.recommendation)} — ${esc(g.verdict.reason)}</p>` : ''}
    ${(g.milestones || []).map((m, i) => `<details class="ms"><summary><span class="tag">L${i + 1}</span>${esc(m.title)} <span class="meta">${m.checks.filter((c) => c.verified).length}/${m.checks.length}</span></summary>
      <p class="note">Win: ${esc(m.win)}</p><ul class="checks">${m.checks.map((c) => `<li class="${c.verified ? 'ok' : ''}">${c.verified ? '✓' : '○'} ${esc(c.text)}${c.evidence ? ` <span class="meta">— ${esc(c.evidence)}</span>` : ''}</li>`).join('')}</ul></details>`).join('')}
  </section>`).join('');

  const taskRows = tasks.slice().reverse().map((t) => `<div class="item"><div class="plain"><span class="tag">${esc(t.status)}</span>${esc(t.title)}</div><div class="meta">${esc(t.id)} · ${esc(t.agent)} · done when: ${esc(t.doneCheck)}</div></div>`);
  const kinds = [['rule', 'Rules'], ['never', 'Never again'], ['decision', 'Decisions'], ['pref', 'Preferences'], ['fact', 'Facts']];
  const active = memory.filter((m) => m.status === 'active');
  const memCards = kinds.map(([k, label]) => {
    const rows = active.filter((m) => m.kind === k).reverse().map((m) => `<div class="item"><div class="plain">${esc(m.text)}</div><div class="meta">${esc(m.id)} · ${esc(m.date)}</div></div>`);
    return rows.length ? `<details class="mem"><summary>${label} <span class="meta">${rows.length}</span></summary>${capped(rows)}</details>` : '';
  }).join('');
  const msgRows = messages.filter((m) => m.open).reverse().map((m) => `<div class="item"><div class="plain"><span class="tag">${esc(m.kind)}</span>${esc(m.text)}</div><div class="meta">#${m.id} · ${esc(m.from)} → ${esc(m.to)} · ${esc(m.date)}</div></div>`);
  const logRows = log.map((e) => `<div class="item"><div class="plain">${esc(eventText(e))}</div><div class="meta">${esc(e.at)} · ${esc(e.agent || 'war room')}</div></div>`);

  const details = `
    <section class="hud"><h3 style="margin-top:0">Chats</h3>${party ? `<div class="party">${party}</div>` : '<p class="boss-sub">No chats have work yet.</p>'}</section>
    ${goalCards}
    <section class="card"><h2>Tasks</h2>${capped(taskRows) || '<p class="note">None yet.</p>'}</section>
    <section class="card"><h2>Memory · ${active.filter((m) => m.kind !== 'question').length} kept</h2>${memCards || '<p class="note">Empty.</p>'}</section>
    <section class="card"><h2>Open messages</h2>${capped(msgRows) || '<p class="note">None.</p>'}</section>
    <section class="card"><h2>Full log</h2>${capped(logRows) || '<p class="note">Nothing yet.</p>'}</section>`;

  const pills = [
    questions.length ? `<span class="pill warn">${questions.length} waiting on you</span>` : '<span class="pill ok">Nothing waits on you</span>',
    `<span class="pill ${working.size ? 'ok' : ''}">${working.size} chat${working.size === 1 ? '' : 's'} working</span>`,
    reports.length ? `<span class="pill">${reports.length} to check</span>` : '',
  ].join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>War room · ${esc(cfg.project)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap">
<style>
:root{--bg:#0e0d12;--surface:#17151d;--surface2:#201d29;--ink:#eeeaf6;--muted:#a09bb0;--line:#2d2938;--accent:#a184f2;--accent-ink:#130c26;--ok:#5ac38a;--warn:#e2a64f;--bad:#f2766c;--font:"Geist",system-ui,-apple-system,sans-serif;--mono:"Geist Mono",ui-monospace,Menlo,monospace;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 var(--font);padding:18px 16px 48px}
.wrap{max-width:640px;margin:0 auto;display:grid;gap:16px}
h1{font-size:22px;letter-spacing:-.01em;margin:0}
h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 10px;font-weight:600}
.sub,.meta{font-family:var(--mono);font-size:12px;color:var(--muted)}.sub{font-size:13px;margin-top:2px}
.pills{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.pill{font-size:12.5px;padding:3px 10px;border-radius:999px;background:var(--surface2);color:var(--muted);font-weight:500}.pill.ok{color:var(--ok)}.pill.warn{color:var(--warn)}
.tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;background:var(--surface);border:1px solid var(--line);border-radius:12px;position:sticky;top:8px;z-index:3}
.tabs button{border:0;background:none;color:var(--muted);padding:9px;border-radius:9px;font-weight:600}
.tabs button.on{background:var(--accent);color:var(--accent-ink)}
.pane{display:none;gap:16px}.pane.on{display:grid}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 15px;min-width:0}
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
.hud-do{margin-top:4px;color:#ffb454;overflow-wrap:anywhere}.hud-last{margin-top:4px;color:var(--muted);overflow-wrap:anywhere}
@keyframes pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style></head><body><div class="wrap">
<header><h1>War room · ${esc(cfg.project)}</h1><div class="sub">${esc(now())}${live ? ' · live' : ' · snapshot'}</div><div class="pills">${pills}</div></header>
<nav class="tabs"><button type="button" class="on" data-go="main">Main</button><button type="button" data-go="details">Details</button></nav>
<div class="pane on" id="main">${hud}${needs}${recentCard}</div>
<div class="pane" id="details">${details}</div>
</div>
<script>
const LIVE=${live ? 'true' : 'false'};
function go(id){document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('on',p.id===id));document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.go===id));scrollTo(0,0);try{localStorage.setItem('wr-tab',id)}catch{}}
document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
try{const t=localStorage.getItem('wr-tab');if(t)go(t)}catch{}
document.querySelectorAll('[data-fill]').forEach(b=>b.onclick=()=>{b.closest('.q').querySelector('textarea').value=b.dataset.fill});
const shq=s=>"'"+s.replace(/'/g,"'\\\\''")+"'";
async function post(path,body,out,fallback){
  if(!LIVE){out.className='note out';out.innerHTML='Copy and run in a terminal (or open this page with <code>war-room serve</code> to send from here):<br><code>'+fallback.replace(/</g,'&lt;')+'</code>';return false}
  try{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw new Error(j.error||'failed');out.className='note out ok';out.textContent='Saved. The commander has it now.';return true}
  catch(e){out.className='note out bad';out.textContent='Not saved: '+e.message;return false}}
document.querySelectorAll('[data-answer]').forEach(b=>b.onclick=async()=>{const q=b.closest('.q'),text=q.querySelector('textarea').value.trim(),out=q.querySelector('.out');if(!text){out.className='note out bad';out.textContent='Type an answer first.';return}
  b.disabled=true;if(await post('/api/answer',{questionId:b.dataset.answer,text},out,'war-room answer --question '+b.dataset.answer+' --text '+shq(text)))setTimeout(()=>location.reload(),900);else b.disabled=false});
document.getElementById('thoughtSend').onclick=async e=>{const t=document.getElementById('thought'),out=e.target.parentElement.querySelector('.out'),text=t.value.trim();if(!text)return;
  e.target.disabled=true;if(await post('/api/thought',{text},out,'war-room call post_message '+shq(JSON.stringify({agent:'founder',to:'commander',kind:'info',text}))))t.value='';e.target.disabled=false};
if(LIVE)setInterval(async()=>{try{const r=await fetch('/api/version');const v=await r.text();if(window.__v&&v!==window.__v&&!document.activeElement.matches('textarea'))location.reload();window.__v=v}catch{}},5000);
</script></body></html>`;
}
