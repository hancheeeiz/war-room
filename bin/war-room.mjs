#!/usr/bin/env node
// War room CLI: init, status, brief, call, and the hooks (session-start briefing, founder-yes guard).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { Store, now, sign, userConfig, userDir } from '../server/store.mjs';
import { addonList, approveAddon, startAddons } from '../server/addons.mjs';
import { LABEL, enginePidFile, enginePath, engineRunning, loginItem, morningRun, vbsText, plistPath, plistText, register, registered, sweepWork, tidyInbox, unregister } from '../server/engine.mjs';
import { resumeAfterApproval, shellSpec, wakeCommander, wakeMember } from '../server/agents.mjs';
import { STARTER_RULES, starterRules } from '../server/starter-rules.mjs';
import { autoRemember, brief, callTool, consumeApproval, dailyCheck, requestApproval, resolveApproval, markRead, ruleInForce, tickToday } from '../server/tools.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, dflt) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : dflt; };
const store = new Store();

// Actions that always need the founder's yes at that step, whatever permissions the agent has.
const FOUNDER_YES = [
  [/\bgit\b[^|;&\n]*?\bpush\b/, 'git push'],
  // An agent must never answer for the founder or rewrite the war room's approvals and settings.
  // Switching the guard itself off is a founder decision too.
  [/\bclaude\s+(plugin|plugins|mcp)\s+(disable|uninstall|remove|rm)\b|\.claude\/(settings[^\s/]*\.json|plugins\/)|hooks\/hooks\.json/, 'switching off or changing the safety guard'],
  // Any shell command that touches .warroom or names the approvals file asks first (covers cd, cp, node -e …).
  [/\bwar-room(\.mjs)?\b[^|;&\n]*\b(approve|answer|founder_answer|decide_goal|confirm-rules|tick|read|addon)\b|\bwar-room(\.mjs)?\b[^|;&\n]*\brules\s+--o(ff|n)\b|\.warroom\b|\bapprovals\.json\b|\.config\/war-room\b|\bWAR_ROOM_HOME\b/, 'approving, answering for the founder, or changing war-room files'],
  // Task tools from the shell would let one chat take, report or check work under another chat's name.
  [/\bwar-room(\.mjs)?\b[^|;&\n]*\bcall\s+['"]?(get_task_packet|report_done|verify_task|create_task|reassign_task)\b/, 'taking, reporting or checking a task from the shell (each role works in its own chat)'],
  [/\b(firebase|vercel|netlify|fly|flyctl|wrangler|eas|amplify|gcloud|aws|heroku|render)\b[^|;&]*\b(deploy|publish|submit)\b|--prod\b|\bkubectl\s+(apply|delete|rollout|scale)\b|\bterraform\s+(apply|destroy)\b|\bdocker\s+push\b|\bsupabase\s+(db\s+push|functions\s+deploy)\b|\brailway\s+up\b/, 'deploy'],
  [/\b(npm|pnpm|yarn|bun)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgem\s+push\b|\bpod\s+trunk\s+push\b|\bgh\s+release\s+(create|upload|edit)\b|\bgh\s+repo\s+(create|edit|rename|archive)\b|\bgh\s+pr\s+merge\b/, 'publishing'],
  // Connecting another agent changes that tool's own settings files.
  [/\bwar-room(\.mjs)?\b[^|;&\n]*\bconnect\b/, 'connecting another agent (changes its settings)'],
  [/\bosascript\b[^|;&]*\b(send|Messages|Mail)\b|\b(sendmail|mailx?)\s|hooks\.slack\.com|discord(app)?\.com\/api\/webhooks|api\.telegram\.org|\bgh\s+(issue|pr)\s+(comment|create)\b/, 'sending messages for the founder'],
  [/\b(altool|notarytool|fastlane|transporter)\b|\bxcrun\s+altool\b/, 'App Store / TestFlight upload'],
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-[a-z]*r\b|--recursive\b)|\bfind\b[^|;&]*\s-delete\b|\brsync\b[^|;&]*--delete|\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+--force|branch\s+-D)\b|\b(drop|truncate)\s+(table|database|schema)\b|\bdelete\s+from\b|\bfirestore:delete\b|\b(gsutil|gcloud\s+storage|aws\s+s3)\s+rm\b|\bdropdb\b/i, 'deleting data'],
  [/api\.stripe\.com|\bstripe\s+(charges|payment|refunds|transfers|payouts)|\brevenuecat\b.*\b(grant|refund)\b/i, 'money'],
  [/\bsecurity\s+(find|add|delete)-(generic|internet)-password\b|\bgcloud\s+auth\b|\bgh\s+auth\b|\bnpm\s+(login|token)\b/, 'passwords or keys'],
  [/\|\s*(sudo\s+)?(ba|z|da|k)?sh\b|\b(ba|z)?sh\s+<\s*\(\s*(curl|wget)|\bbase64\s+(-d|--decode|-D)\b[^;&]*\|/, 'running downloaded or decoded code'],
  [/\bwar-room(\.mjs)?\b[^|;&\n]*\bengine\s+(install|uninstall|add|remove|run)\b/, 'making something start by itself on this computer'],
  // Each morning run is a paid commander run; the watcher starts one a day by itself.
  [/\bwar-room(\.mjs)?\b[^|;&\n]*\bmorning\b/, 'starting an extra paid commander run'],
  [/\bschtasks\b|\b(Register|New)-ScheduledTask\b|Start Menu[\\/]+Programs[\\/]+Startup|CurrentVersion[\\/]+Run(Once)?\b/i, 'making something start by itself on this computer'],
  [/\blaunchctl\s+(load|bootstrap|enable|submit|kickstart)\b|Library\/LaunchAgents\b|\bcrontab\b/, 'making something start by itself on this computer'],
  [/\bclaude\s+(plugin|mcp)\s+(add|install)\b|\bnpx\s+skills?\s+add\b/, 'installing a skill, plugin or connector'],
];
const RISKY_TOOL = /(deploy|publish|delete|remove|trash|send_message|send_email|charge|payment|refund|purchase|transfer)/i;

function founderYesReason(input) {
  const name = input.tool_name || '';
  // Windows paths use backslashes; the checks below are written with forward slashes.
  const raw = input.tool_input || {};
  const ti = { ...raw, ...(raw.file_path ? { file_path: String(raw.file_path).replace(/\\/g, '/') } : {}), ...(raw.notebook_path ? { notebook_path: String(raw.notebook_path).replace(/\\/g, '/') } : {}) };
  if (name === 'Bash') {
    const command = ti.command || '';
    // Looking at the war room's files is fine; only changing them needs the founder. A plain ls/cat/head/tail/grep/wc
    // with no redirect, pipe, chain or substitution cannot change anything, and the per-user secret stays guarded.
    const readOnly = /^\s*(ls|cat|head|tail|wc|grep)\b[^;&|<>`$\n]*$/.test(command) && !/\.config\/war-room|WAR_ROOM_HOME/.test(command);
    const hit = FOUNDER_YES.find(([re, why]) => re.test(command) && !(readOnly && why.startsWith('approving, answering')));
    return hit && hit[1];
  }
  if (['Write', 'Edit', 'MultiEdit'].includes(name) && /(^|\/)\.env(\.|$)|\.(pem|p8|p12|key)$/.test(ti.file_path || '')) return 'passwords or keys (secret file)';
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name) && /(^|\/)(\.warroom|\.config\/war-room)\//.test(ti.file_path || ti.notebook_path || '')) return 'editing war-room approvals, memory or settings by hand';
  if (['Write', 'Edit', 'MultiEdit'].includes(name) && /\/Library\/LaunchAgents\/|Start Menu\/Programs\/Startup\//i.test(ti.file_path || '')) return 'making something start by itself on this computer';
  if (['Write', 'Edit', 'MultiEdit'].includes(name) && /(^|\/)\.claude\/(settings[^/]*\.json|plugins\/)|(^|\/)hooks\/hooks\.json$/.test(ti.file_path || '')) return 'switching off or changing the safety guard';
  if (name.startsWith('mcp__') && !name.includes('war-room') && RISKY_TOOL.test(name.split('__').pop())) return 'an outside action (send, delete, publish or pay)';
  return null;
}

// One stale pass: post an inbox alert to the commander for every silent claimed task (deduped).
function checkStale(store) {
  const hours = Number(store.config().staleHours) || 2;
  const cutoff = Date.now() - hours * 3600e3;
  const stale = store.read('tasks').filter((t) => t.status === 'claimed' && new Date(t.claimed).getTime() < cutoff);
  if (!stale.length) return 0;
  const commander = store.config().commander;
  let posted = 0;
  store.update('messages', (messages) => {
    for (const t of stale) {
      const tag = `stale ${t.id} claimed ${t.claimed}`;
      if (messages.some((m) => m.open && m.text.startsWith(tag))) continue;
      messages.push({ id: messages.length + 1, from: 'war-room-watch', to: commander, kind: 'conflict', text: `${tag}: "${t.title}" claimed by ${t.agent}, no report for over ${hours}h. Nudge it or reassign_task.`, date: now(), open: true });
      posted += 1;
    }
  });
  if (posted) {
    store.log({ agent: 'war-room-watch', event: 'stale_alert', count: posted });
    for (const t of stale) autoRemember(store, { kind: 'problem', text: `${t.id} (${t.title}): ${t.agent} went silent after claiming it at ${t.claimed}`, source: 'war-room-watch', tags: [t.id, t.agent] });
  }
  return posted;
}

// The founder's own notifier (e.g. a push script): "notifyCommand" in ~/.config/war-room/config.json, never in a
// project, so a downloaded project cannot make the war room run its commands. It gets the message as one argument.
function notify(store, message) {
  console.error(`${now()} ${message}`);
  const cmd = userConfig().notifyCommand;
  if (!cmd) return;
  if (process.platform === 'win32') {
    const sh = shellSpec(`${cmd} "${String(message).replace(/["%\r\n]/g, ' ')}"`);
    execFile(sh.bin, sh.args, sh.opts, () => {});
  } else execFile('/bin/sh', ['-c', `${cmd} "$1"`, 'warroom-notify', message], () => {});
}

function bar(pct, width = 20) {
  const n = Math.round((pct / 100) * width);
  return `${'█'.repeat(n)}${'░'.repeat(width - n)} ${String(pct).padStart(3)}%`;
}

// The founder's page: answers, thoughts, approvals. 127.0.0.1 by default; --lan opens it to phones on the same
// Wi-Fi, and then every request must carry the secret link token.
async function serve(opts = {}) {
  const http = await import('node:http');
  const crypto = await import('node:crypto');
  const os = await import('node:os');
  const { renderDashboard } = await import('../server/dashboard.mjs');
  const port = Number(opts.port ?? flag('port', 4818));
  const lan = opts.lan ?? rest.includes('--lan');
  // A fresh secret link on every start; --keep-link reuses the last one (kept in the user folder, never the project).
  const keepFile = `${userDir()}/lan-link`;
  let token = (opts.keepLink ?? rest.includes('--keep-link')) && fs.existsSync(keepFile) ? fs.readFileSync(keepFile, 'utf8').trim() : crypto.randomBytes(24).toString('base64url');
  if (lan) fs.writeFileSync(keepFile, token, { mode: 0o600 });
  const tokenOk = (got) => !lan || (typeof got === 'string' && got.length === token.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(token)));
  const version = () => ['memory', 'goals', 'tasks', 'messages', 'approvals', 'runs', 'debates', 'team', 'shelf', 'progress'].map((n) => { try { return fs.statSync(`${store.root}/${n}.json`).mtimeMs; } catch { return 0; } }).join('-')
    + (fs.existsSync(`${store.root}/log.jsonl`) ? fs.statSync(`${store.root}/log.jsonl`).mtimeMs : 0);
  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const actions = {
    '/api/answer': (b) => callTool(store, 'founder_answer', { agent: store.config().commander, questionId: String(b.questionId), founderWords: String(b.text) }),
    '/api/thought': (b) => {
      const out = callTool(store, 'post_message', { agent: 'founder', to: 'commander', kind: 'info', text: `Founder thought: ${b.text}` });
      if (!out.error) autoRemember(store, { kind: 'idea', text: String(b.text), source: 'founder' });
      return out;
    },
    // The one box on the page: tell the commander anything, answer one of its questions, or talk to one team member.
    // Whoever it is for is started in the background to handle it, so the founder never has to open a chat.
    '/api/say': (b) => {
      const text = String(b.text);
      const commander = store.config().commander;
      let out;
      if (b.answer) {
        out = callTool(store, 'founder_answer', { agent: commander, questionId: String(b.answer), founderWords: text });
        if (!out.error) callTool(store, 'post_message', { agent: 'founder', to: 'commander', kind: 'info', text: `Founder answered ${b.answer}: ${text}` });
      } else if (b.to && b.to !== commander && b.to !== 'commander') {
        if (!store.read('team').some((m) => m.name === b.to)) return { error: `No team member ${b.to}.` };
        out = callTool(store, 'post_message', { agent: 'founder', to: String(b.to), kind: 'request', text: `From the founder: ${text}` });
      } else {
        out = callTool(store, 'post_message', { agent: 'founder', to: 'commander', kind: 'info', text: `Founder: ${text}` });
        if (!out.error) autoRemember(store, { kind: 'idea', text, source: 'founder' });
      }
      if (out.error) return out;
      try {
        const run = b.to && b.to !== 'commander' && !b.answer ? wakeMember(store, String(b.to)) : wakeCommander(store);
        return { text: run ? `started ${run.name}` : 'queued' };
      } catch (e) {
        autoRemember(store, { kind: 'problem', text: `Could not start a chat for the founder's message: ${e.message}`, source: 'war-room page' });
        return { text: 'queued' };
      }
    },
    '/api/approve': (b) => {
      try {
        const ap = resolveApproval(store, { id: String(b.id), yes: b.yes === true, by: 'founder (war-room page)' });
        callTool(store, 'post_message', { agent: 'founder', to: ap.agent, kind: 'info', text: `${ap.id} ${ap.status} by the founder: ${ap.action}` });
        resumeAfterApproval(store, ap);
        return { text: 'ok' };
      } catch (e) { return { error: e.message }; }
    },
    // The founder ticks one of today's goals that has no task behind it.
    '/api/today': (b) => {
      if (!Number.isInteger(b.index) || b.index < 0) return { error: 'Bad item.' };
      try {
        tickToday(store, { goalId: String(b.goalId), index: b.index, text: b.text === undefined ? undefined : String(b.text), done: b.done !== false });
        return { text: 'ok' };
      } catch (e) { return { error: e.message }; }
    },
    // The founder marks a shelf note read or unread.
    '/api/read': (b) => {
      try { markRead(store, { id: String(b.id), read: b.read !== false }); return { text: 'ok' }; } catch (e) { return { error: e.message }; }
    },
    // The founder approves or switches off an add-on the commander registered.
    '/api/addon': (b) => {
      try { approveAddon(store, { name: String(b.name), approve: b.approve !== false }); return { text: 'ok' }; } catch (e) { return { error: e.message }; }
    },
    '/api/goal': (b) => {
      const out = callTool(store, 'decide_goal', { agent: store.config().commander, goalId: String(b.goalId), choice: String(b.choice), founderWords: `chose "${b.choice}" on the war-room page` });
      // A kept goal needs a plan next: let the commander carry on without the founder opening a chat.
      if (!out.error && ['keep', 'improve'].includes(String(b.choice))) {
        callTool(store, 'post_message', { agent: 'founder', to: 'commander', kind: 'info', text: `Founder chose "${b.choice}" for goal ${b.goalId} on the page. Plan it: set_plan, hire the roles it needs, hand out the first tasks.` });
        try { wakeCommander(store); } catch {}
      }
      return out;
    },
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!tokenOk(url.searchParams.get('t') || req.headers['x-war-room-token'])) { res.writeHead(403); return res.end('Forbidden'); }
    // A local page must only answer to localhost names, or a malicious site could rebind its DNS to it.
    if (!lan && !new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]).has(req.headers.host)) { res.writeHead(403); return res.end('Forbidden host'); }
    if (req.method === 'POST' && !String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'JSON only.' });
    const origin = req.headers.origin;
    if (req.method === 'POST' && origin && origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Cross-site request refused.' });
    if (req.method === 'GET' && url.pathname === '/api/version') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(version()); }
    if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" }); return res.end(renderDashboard(store, { live: true })); }
    if (req.method === 'POST' && actions[url.pathname]) {
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 20000) req.destroy(); });
      req.on('end', () => {
        let b = {};
        try { b = JSON.parse(body); } catch { return json(res, 400, { error: 'Bad request.' }); }
        if (['/api/answer', '/api/thought', '/api/say'].includes(url.pathname) && !String(b.text || '').trim()) return json(res, 400, { error: 'Empty.' });
        const out = actions[url.pathname](b);
        if (out.error) return json(res, 400, { error: out.error });
        notify(store, `Founder used the war-room page (${url.pathname.slice(5)}).`);
        return json(res, 200, { ok: true, result: out.text });
      });
      return;
    }
    res.writeHead(404); res.end('Not found');
  });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${port} is busy: the war room page is probably already running (open http://127.0.0.1:${port}/), or pick another with --port.` : e.message);
    process.exit(1);
  });
  server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
    opts.onListen?.({ port, lan, token });
    console.log(`War room page: http://127.0.0.1:${port}/${lan ? `?t=${token}` : ''}`);
    if (lan) {
      for (const nets of Object.values(os.networkInterfaces())) for (const n of nets || []) if (n.family === 'IPv4' && !n.internal) console.log(`On your phone (same Wi-Fi): http://${n.address}:${port}/?t=${token}`);
      console.log('Keep this link private: anyone on the same Wi-Fi with it can answer and approve.');
    }
  });
}

// Stale-task alarm plus instant notify on war-room file changes. No polling of chats.
async function startWatch(opts = {}) {
  const mins = Number(opts.every ?? flag('every', 10));
  const { renderDashboard } = await import('../server/dashboard.mjs');
  const redraw = () => { try { fs.writeFileSync(`${store.root}/dashboard.html`, renderDashboard(store)); } catch {} };
  console.log(`Watching ${store.root}: stale check every ${mins} min; file changes redraw the dashboard and notify instantly. Ctrl-C to stop.`);
  const pass = () => {
    const n = checkStale(store);
    if (n) notify(store, `${n} stale task(s) — alert in the commander's inbox.`);
    try { const daily = dailyCheck(store); if (daily) notify(store, daily); } catch {}
    try { tidyInbox(store); } catch {}
    // Hand fresh untaken work to the team, then wake the commander once each morning when something needs it.
    try {
      const s = sweepWork(store);
      if (s.started.length) notify(store, `Started ${s.started.map((x) => `${x.name} for ${x.task}`).join(', ')}.`);
    } catch (e) { console.error(`sweep: ${e.message}`); }
    try {
      const m = morningRun(store);
      if (m?.run) notify(store, `Morning run: the commander is looking at ${m.need.join(', ')}.`);
    } catch (e) { console.error(`morning run: ${e.message}`); }
    redraw();
  };
  pass();
  setInterval(pass, mins * 60e3);
  let debounce;
  let quiet;
  fs.watch(store.root, (ev, f) => {
    if (!f?.endsWith('.json') && f !== 'log.jsonl') return;
    if (['config.json', 'lock', 'up.json'].includes(f)) return;
    // Heartbeats and progress lines change all the time: redraw for them, but do not notify the founder.
    if (['duty.json', 'progress.json'].includes(f)) { clearTimeout(quiet); quiet = setTimeout(redraw, 1500); return; }
    clearTimeout(debounce);
    debounce = setTimeout(() => { redraw(); notify(store, `War room updated (${f}).`); }, 1500);
  });
}

switch (cmd) {
  case 'init': {
    const cfg = store.init({ project: flag('project'), commander: flag('commander', 'commander') });
    console.log(`War room ready in ${store.root} (project ${cfg.project}, commander "${cfg.commander}").`);
    break;
  }
  case 'status': {
    if (!store.exists()) { console.log('No war room here. Start one with /war-room.'); break; }
    const out = JSON.parse(callTool(store, 'war_room_status').text);
    for (const g of out.goals) {
      console.log(`\n${g.id} ${g.title} [${g.status}]\n  ${bar(g.percent)}  (${g.verifiedChecks} checks verified)`);
      for (const m of g.milestones) console.log(`  ${m.id.padEnd(8)} ${bar(m.percent, 10)}  ${m.title}`);
      for (const t of g.today) console.log(`  today ${t.done ? '[x]' : '[ ]'} ${t.text}`);
    }
    for (const [agent, ts] of Object.entries(out.agents)) console.log(`\n${agent}:\n  ${ts.join('\n  ')}`);
    console.log(`\nLast ${out.log.length} events:`);
    for (const e of out.log) console.log(`  ${e.at} ${e.agent || ''} ${e.event} ${e.id || ''}`);
    break;
  }
  case 'brief':
    console.log(brief(store, flag('agent', process.env.WAR_ROOM_AGENT)));
    break;
  case 'call': {
    const out = await callTool(store, rest[0], rest[1] ? JSON.parse(rest[1]) : {});
    if (out.error) { console.error(out.error); process.exitCode = 1; } else console.log(out.text);
    break;
  }
  case 'dashboard': {
    if (!store.exists()) { console.log('No war room here. Start one with /war-room.'); break; }
    const { renderDashboard } = await import('../server/dashboard.mjs');
    const file = `${store.root}/dashboard.html`;
    fs.writeFileSync(file, renderDashboard(store));
    console.log(file);
    break;
  }
  case 'serve':
    if (!store.exists()) { console.log('No war room here. Start one with /war-room.'); break; }
    await serve();
    break;
  case 'up': {
    // One command for the founder: the page (and the phone link with --phone) plus the dead-chat watcher.
    if (!store.exists()) { console.log('No war room here. Start one with /war-room in Claude Code.'); break; }
    const port = Number(flag('port', 4818));
    const lan = rest.includes('--phone') || rest.includes('--lan');
    const upFile = `${store.root}/up.json`;
    // Claim the war room before starting anything, so the engine and a hand-started page never both run watchers
    // (two watchers could start the same worker twice). Create-exclusive; a claim left by a dead process is replaced.
    let claimed = false;
    for (let i = 0; i < 2 && !claimed; i += 1) {
      try { fs.writeFileSync(upFile, JSON.stringify({ pid: process.pid, starting: now() }), { flag: 'wx' }); claimed = true; } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let up = {};
        try { up = JSON.parse(fs.readFileSync(upFile, 'utf8')); } catch {}
        let alive = false;
        try { process.kill(up.pid, 0); alive = true; } catch (err) { alive = err.code === 'EPERM'; }
        if (alive && up.pid !== process.pid) { console.log(`The war room is already up${up.port ? `: http://127.0.0.1:${up.port}/` : ''} (process ${up.pid}). Stop it with: kill ${up.pid}`); break; }
        fs.rmSync(upFile, { force: true });
      }
    }
    if (!claimed) break;
    process.on('exit', () => { try { if (JSON.parse(fs.readFileSync(upFile, 'utf8')).pid === process.pid) fs.rmSync(upFile); } catch {} });
    await serve({ port, lan, keepLink: rest.includes('--keep-link'), onListen: () => {
      fs.writeFileSync(upFile, JSON.stringify({ pid: process.pid, port, lan, started: now() }));
      if (!rest.includes('--no-open') && process.platform === 'darwin') execFile('open', [`http://127.0.0.1:${port}/`], () => {});
      if (!rest.includes('--no-open') && process.platform === 'win32') execFile(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '""', `http://127.0.0.1:${port}/`], { windowsHide: true }, () => {});
    } });
    await startWatch({ every: Number(flag('every', 10)) });
    for (const a of await startAddons(store)) console.log(`Started add-on ${a.name} (log ${a.log}).`);
    const bye = () => { try { if (JSON.parse(fs.readFileSync(upFile, 'utf8')).pid === process.pid) fs.rmSync(upFile); } catch {} process.exit(0); };
    process.on('SIGINT', bye); process.on('SIGTERM', bye);
    break;
  }
  case 'spawn': {
    // Start a worker chat in the background: war-room spawn frontend [--agent claude|codex|gemini|cursor] [--model sonnet]
    if (!store.exists()) { console.log('No war room here. Start one with /war-room.'); break; }
    const { startWorker } = await import('../server/agents.mjs');
    try {
      const run = startWorker(store, { name: rest[0], agent: flag('agent', 'claude'), model: flag('model') });
      console.log(`${run.id}: worker "${run.name}" started with ${run.agent}${run.model ? ` (${run.model})` : ''}. Log: ${run.log}`);
    } catch (e) { console.error(e.message); process.exitCode = 1; }
    break;
  }
  case 'runs': {
    const { runStatus } = await import('../server/agents.mjs');
    const runs = store.exists() ? store.read('runs') : [];
    if (!runs.length) console.log('No worker chats started yet.');
    for (const r of runs) console.log(`${r.id} ${r.name.padEnd(14)} ${r.agent}${r.model ? `:${r.model}` : ''} ${runStatus(r).padEnd(9)} started ${r.started} · ${r.log}`);
    break;
  }
  case 'debate': {
    // war-room debate "question" [--seats claude:opus,codex,gemini] [--rounds 2]   (or --id dN to run a queued one)
    if (!store.exists()) { console.log('No war room here. Start one with /war-room.'); break; }
    const { createDebate, runDebate } = await import('../server/agents.mjs');
    let id = flag('id');
    try {
      if (!id) {
        const q = rest.find((x, i) => !x.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--')));
        if (!q) { console.log('Ask a question: war-room debate "Should we …?"'); process.exitCode = 1; break; }
        const d = createDebate(store, { question: q, seats: flag('seats')?.split(',').filter(Boolean), rounds: Number(flag('rounds', 2)), by: flag('by', 'founder (cli)') });
        id = d.id;
        console.log(`${d.id}: ${d.seats.map((x) => x.seat).join(', ')} (${d.companies.join(', ')})${d.companies.length < 2 ? '\nAll seats are from one company: agreement between them is weak evidence. Run war-room doctor to connect another.' : ''}`);
      }
      const d = await runDebate(store, id, { timeoutMs: Number(flag('timeout', 600)) * 1000 });
      for (const [r, round] of d.results.entries()) {
        console.log(`\n── Round ${r + 1}${r ? ' (after reading the others)' : ' (blind)'} ──`);
        for (const a of round) console.log(`\n[${a.seat}]${a.ok ? '' : ' FAILED'}\n${a.text}`);
      }
      console.log('\n── Final answers ──');
      for (const f of d.finals) console.log(`${f.seat}: ${f.final}`);
    } catch (e) { console.error(e.message); process.exitCode = 1; }
    break;
  }
  case 'connect': {
    // Join Codex, Gemini CLI or Cursor to this computer's war room. Shows the change first; writes with --yes.
    const { connectAgent } = await import('../server/agents.mjs');
    try {
      const project = store.exists() ? path.dirname(store.root) : null;
      const out = connectAgent(rest[0], { project, write: rest.includes('--yes') });
      if (!out.changes.length) { console.log(`${rest[0]} is already connected.`); break; }
      console.log(`${rest.includes('--yes') ? 'Done' : 'Will'}:\n  ${out.changes.join('\n  ')}`);
      if (!rest.includes('--yes')) console.log(`\nRun again with --yes to do it (a backup is kept next to the file).`);
      if (!out.installed) console.log(`\nNote: ${rest[0]} is not installed on this computer yet.`);
    } catch (e) { console.error(e.message); process.exitCode = 1; }
    break;
  }
  case 'doctor': {
    // One look at everything: what is installed, connected and running, and the next step for each gap.
    const { recipes, which, isConnected, CONNECT, runStatus } = await import('../server/agents.mjs');
    const ok = (b) => (b ? '✓' : '·');
    console.log(`War room doctor · node ${process.versions.node}${Number(process.versions.node.split('.')[0]) < 18 ? ' (needs 18+)' : ''}`);
    console.log(`\nThis project: ${store.exists() ? `war room ready (${store.root})` : 'no war room yet → type /war-room your goal in Claude Code'}`);
    if (store.exists()) {
      let up = null;
      try { up = JSON.parse(fs.readFileSync(`${store.root}/up.json`, 'utf8')); process.kill(up.pid, 0); } catch { up = null; }
      console.log(`Page: ${up ? `running at http://127.0.0.1:${up.port}/${up.lan ? ' (phone link on)' : ''}` : 'not running → war-room up   (add --phone for your phone)'}`);
      const runs = store.read('runs').filter((r) => runStatus(r) === 'running');
      console.log(`Worker chats running: ${runs.length ? runs.map((r) => r.name).join(', ') : 'none'}`);
    }
    console.log('\nCoding agents (different companies argue better):');
    for (const [name, r] of Object.entries(recipes())) {
      const have = !!which(r.bin);
      const conn = CONNECT[name] ? isConnected(name) : null;
      // Debates only need the agent installed; taking tasks from the war room also needs it connected.
      const next = !have ? `not installed${name === 'claude' ? '' : ' (optional)'}` : conn === false ? `ready for debates · to take tasks too: war-room connect ${name} --yes` : 'ready';
      console.log(`  ${ok(have)} ${name.padEnd(8)} ${r.company.padEnd(16)} ${next}`);
    }
    console.log(`Engine: ${loginItem() && fs.existsSync(loginItem().file) ? `on (${registered().length} war room(s))` : 'off → war-room engine install (keeps war rooms running when no chat is open)'}`);
    console.log(`\nNotifications: ${userConfig().notifyCommand ? 'on' : 'off (optional: set notifyCommand in ~/.config/war-room/config.json)'}`);
    break;
  }
  case 'check-stale': {
    if (!store.exists()) { console.log('No war room here.'); break; }
    const n = checkStale(store);
    console.log(n ? `${n} stale task alert(s) posted to the commander's inbox.` : 'No stale tasks.');
    break;
  }
  case 'rules': {
    // Built-in starter rules (on for everyone) plus the rules this project's founder confirmed.
    const id = flag('off') || flag('on');
    if (id) {
      if (!STARTER_RULES.some((r) => r.id === id)) { console.log(`No starter rule ${id}.`); process.exitCode = 1; break; }
      if (!rest.includes('--yes')) { console.log(`Add --yes to switch ${id} ${flag('off') ? 'off' : 'on'} on this computer.`); break; }
      const f = `${userDir()}/config.json`;
      const cfg = userConfig();
      const off = new Set(cfg.startersOff || []);
      if (flag('off')) off.add(id); else off.delete(id);
      fs.writeFileSync(f, JSON.stringify({ ...cfg, startersOff: [...off] }, null, 2), { mode: 0o600 });
      console.log(`Starter rule ${id} is now ${flag('off') ? 'off' : 'on'} for every war room on this computer.`);
      break;
    }
    console.log('Starter rules (built in):');
    for (const r of starterRules({ includeOff: true })) console.log(`  ${r.id}${r.off ? ' (off)' : ''} [${r.kind}] ${r.text}`);
    const mine = store.exists() ? store.read('memory').filter(ruleInForce) : [];
    console.log(`\nYour confirmed rules here: ${mine.length}`);
    for (const m of mine) console.log(`  ${m.id} [${m.kind}] ${m.text}`);
    console.log('\nAdd your own rule: tell the commander "new rule: …" in chat, then tap Approve on the page.');
    console.log('Switch a starter rule off: war-room rules --off s3 --yes · back on: --on s3 --yes');
    break;
  }
  case 'confirm-rules': {
    // The founder signs rules that came from elsewhere (an import, an older war room) so they take effect here.
    const pending = store.read('memory').filter((m) => ['rule', 'never'].includes(m.kind) && ['active', 'proposed'].includes(m.status) && !ruleInForce(m));
    if (!pending.length) { console.log('All rules are confirmed.'); break; }
    for (const m of pending) console.log(`  ${m.id} [${m.kind}] ${m.text}`);
    if (!rest.includes('--yes')) { console.log(`\n${pending.length} rule(s) are not in force. Read them, then run: war-room confirm-rules --yes`); break; }
    store.update('memory', (memory) => {
      for (const m of memory) if (pending.some((p) => p.id === m.id)) Object.assign(m, { status: 'active', confirmedBy: 'founder (cli)', sig: sign(`rule|${m.id}|${m.kind}|${m.text}`) });
    });
    store.log({ agent: 'founder (cli)', event: 'rules_confirmed', count: pending.length });
    console.log(`${pending.length} rule(s) confirmed and now shown to every chat.`);
    break;
  }
  case 'approve': {
    // Founder approves or denies from any terminal (also over SSH from a phone).
    try {
      const ap = resolveApproval(store, { id: flag('id'), yes: rest.includes('--yes'), by: 'founder (cli)' });
      console.log(`${ap.id} ${ap.status}: ${ap.action}`);
      const resumed = resumeAfterApproval(store, ap);
      if (resumed) console.log(`Worker "${resumed.name}" restarted to carry on (${resumed.id}).`);
    } catch (e) { console.error(e.message); process.exitCode = 1; }
    break;
  }
  case 'tick': {
    // The founder ticks today's goal number N (as shown on the page) from the terminal: war-room tick --item 2 [--undo]
    if (!store.exists()) { console.log('No war room here.'); break; }
    const goals = store.read('goals').filter((g) => g.status !== 'dropped');
    const goalId = flag('goal') || (goals.find((g) => g.status === 'active') || goals[0])?.id;
    try {
      const it = tickToday(store, { goalId, index: Number(flag('item')) - 1, done: !rest.includes('--undo') });
      console.log(`${it.done ? '[x]' : '[ ]'} ${it.text}`);
    } catch (e) { console.error(e.message); process.exitCode = 1; }
    break;
  }
  case 'read': {
    // The founder marks a shelf note read from the terminal: war-room read --note b2 [--undo]
    if (!store.exists()) { console.log('No war room here.'); break; }
    try {
      const b = markRead(store, { id: flag('note'), read: !rest.includes('--undo') });
      console.log(`${b.readAt ? '[read]' : '[not read]'} ${b.title}`);
    } catch (e) { console.error(e.message); process.exitCode = 1; }
    break;
  }
  case 'answer': {
    // The founder answers a queued question from the terminal (or a phone bridge calls this): instant, no polling.
    const out = callTool(store, 'founder_answer', { agent: store.config().commander, questionId: flag('question'), founderWords: flag('text') });
    if (out.error) { console.error(out.error); process.exitCode = 1; break; }
    console.log(out.text);
    notify(store, `Founder answered ${flag('question')} — the commander can continue.`);
    break;
  }
  case 'watch':
    if (!store.exists()) { console.log('No war room here. Start one with /war-room.'); break; }
    await startWatch();
    break;
  case 'engine': {
    // The always-on engine. install/uninstall need the founder (the guard asks); run is what macOS starts at login.
    const sub = rest[0] || 'status';
    const dirs = () => { const d = rest.filter((x, i) => i > 0 && rest[i - 1] === '--project'); return d.length ? d : [process.env.WAR_ROOM_DIR || process.cwd()]; };
    const engineLog = path.join(userDir(), 'engine.log');
    try {
      if (sub === 'add') { for (const d of dirs()) { const e = register(d); console.log(`Added ${e.dir} (page port ${e.port}).`); } break; }
      if (sub === 'remove') { for (const d of dirs()) console.log(unregister(d) ? `Removed ${path.resolve(d)}.` : `${path.resolve(d)} was not in the list.`); break; }
      if (sub === 'install') {
        for (const d of dirs()) { const e = register(d); console.log(`War room: ${e.dir} (page port ${e.port})`); }
        const cli = path.resolve(process.argv[1]);
        if (process.platform === 'win32') {
          const file = loginItem().file;
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, vbsText({ node: process.execPath, cli }));
          console.log(`\nStartup script written: ${file}`);
          if (rest.includes('--no-load')) break;
          if (engineRunning()) { console.log('Engine is already running. It starts by itself every time you log in. Log: ' + engineLog); break; }
          const { spawn } = await import('node:child_process');
          spawn(process.execPath, [cli, 'engine', 'run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
          console.log('Engine is on: it starts now and every time you log in. Log: ' + engineLog);
          break;
        }
        if (process.platform !== 'darwin') { console.log('\nStarting at login is built in for macOS and Windows. On this computer, keep this running instead (e.g. in tmux or a service): war-room engine run'); break; }
        const file = plistPath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, plistText({ node: process.execPath, cli: path.resolve(process.argv[1]), pathEnv: enginePath(), log: engineLog }));
        console.log(`\nLogin item written: ${file}`);
        if (rest.includes('--no-load')) break;
        const { spawnSync } = await import('node:child_process');
        const uid = process.getuid();
        spawnSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' });
        const r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, file], { encoding: 'utf8' });
        console.log(r.status === 0 ? 'Engine is on: it starts now and every time you log in. Log: ' + engineLog : `Could not start it: ${(r.stderr || '').trim()}`);
        break;
      }
      if (sub === 'uninstall') {
        if (process.platform === 'darwin') {
          const { spawnSync } = await import('node:child_process');
          if (!rest.includes('--no-load')) spawnSync('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`], { stdio: 'ignore' });
          fs.rmSync(plistPath(), { force: true });
        }
        if (process.platform === 'win32') {
          fs.rmSync(loginItem().file, { force: true });
          const pid = engineRunning();
          if (pid > 0 && !rest.includes('--no-load')) try { process.kill(pid); } catch {}
        }
        console.log('Engine is off. War rooms run only while a page or chat is open. (Your war rooms and their data are untouched.)');
        break;
      }
      if (sub === 'run') {
        // Supervisor: keep `war-room up` running for every registered war room. Each one's watcher does the work.
        const { spawn } = await import('node:child_process');
        const other = engineRunning();
        if (other && other !== process.pid) { console.log(`${now()} the engine is already running (process ${other}).`); break; }
        fs.writeFileSync(enginePidFile(), String(process.pid));
        // Windows has no login-item log: write it ourselves. (macOS sends this process's output to the log already.)
        const logFd = process.platform === 'win32' ? fs.openSync(engineLog, 'a') : null;
        if (logFd !== null) { const w = (...a) => fs.writeSync(logFd, `${a.join(' ')}\n`); console.log = w; console.error = w; }
        const kids = new Map();
        const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
        const check = () => {
          for (const p of registered()) {
            if (!fs.existsSync(path.join(p.dir, '.warroom', 'config.json'))) continue;
            let up = null;
            try { up = JSON.parse(fs.readFileSync(path.join(p.dir, '.warroom', 'up.json'), 'utf8')); } catch {}
            if (up && alive(up.pid)) continue;
            const k = kids.get(p.dir);
            if (k && k.exitCode === null) continue;
            const child = spawn(process.execPath, [path.resolve(process.argv[1]), 'up', '--no-open', '--port', String(p.port)], { cwd: p.dir, env: { ...process.env, WAR_ROOM_DIR: p.dir }, stdio: ['ignore', logFd ?? 'inherit', logFd ?? 'inherit'], windowsHide: true });
            kids.set(p.dir, child);
            console.log(`${now()} started the war room in ${p.dir} (page http://127.0.0.1:${p.port}/)`);
          }
        };
        check();
        setInterval(check, 60e3);
        const bye = () => { for (const k of kids.values()) try { k.kill(); } catch {} try { if (Number(fs.readFileSync(enginePidFile(), 'utf8')) === process.pid) fs.rmSync(enginePidFile()); } catch {} process.exit(0); };
        process.on('SIGINT', bye); process.on('SIGTERM', bye);
        console.log(`${now()} engine running for ${registered().length} war room(s).`);
        break;
      }
      // status
      const item = loginItem();
      const on = !!item && fs.existsSync(item.file);
      console.log(`Engine: ${on ? `on (starts at login${engineRunning() ? ', running now' : ', not running now'})` : 'off → turn it on with: war-room engine install'}`);
      // A plugin update can move the plugin folder; the login item must point at the copy that exists now.
      if (on && process.platform === 'win32') {
        const [, node, cli] = fs.readFileSync(item.file, 'utf8').match(/Run """(.*?)"" ""(.*?)"" engine run/) || [];
        if (node && !fs.existsSync(node.replace(/""/g, '"'))) console.log(`  The node it runs (${node}) is gone. Run war-room engine install again.`);
        if (cli && cli.replace(/""/g, '"') !== path.resolve(process.argv[1])) console.log(`  It runs ${cli}, not this copy. Run war-room engine install again to point it here.`);
      }
      if (on && process.platform === 'darwin') {
        const cli = /<string>engine<\/string>/.test(fs.readFileSync(plistPath(), 'utf8')) && fs.readFileSync(plistPath(), 'utf8').match(/<array><string>[^<]*<\/string><string>([^<]*)<\/string>/)?.[1];
        const node = fs.readFileSync(plistPath(), 'utf8').match(/<array><string>([^<]*)<\/string>/)?.[1];
        if (node && !fs.existsSync(node)) console.log(`  The node it runs (${node}) is gone. Run war-room engine install again.`);
        if (cli && cli !== path.resolve(process.argv[1])) console.log(`  It runs ${cli}, not this copy (${path.resolve(process.argv[1])}).${fs.existsSync(cli) ? '' : ' That file is gone.'} Run war-room engine install again to point it here.`);
      }
      const list = registered();
      if (!list.length) console.log('No war rooms in its list yet.');
      for (const p of list) {
        let up = null;
        try { up = JSON.parse(fs.readFileSync(path.join(p.dir, '.warroom', 'up.json'), 'utf8')); process.kill(up.pid, 0); } catch { up = null; }
        console.log(`  ${up ? '●' : '○'} ${p.dir}  http://127.0.0.1:${p.port}/${up ? '' : '  (not running)'}`);
      }
    } catch (e) { console.error(e.message); process.exitCode = 1; }
    break;
  }
  case 'addon': {
    // The founder's add-ons: list them, approve one (--approve), switch one off (--off), or start the approved ones.
    if (!store.exists()) { console.log('No war room here. Start one with /war-room.'); break; }
    const name = flag('name') || flag('id');
    try {
      if (name && (rest.includes('--approve') || rest.includes('--off'))) {
        const a = approveAddon(store, { name, approve: rest.includes('--approve') });
        console.log(`${a.name}: ${a.off ? 'switched off' : 'approved'}.`);
        break;
      }
      if (rest.includes('--start')) { const s = await startAddons(store); console.log(s.length ? s.map((a) => `Started ${a.name} (log ${a.log})`).join('\n') : 'Nothing to start (not approved, no start command, or already running).'); break; }
      const list = addonList(store, { fresh: true });
      if (!list.length) { console.log('No add-ons yet. The commander registers one with add_feature.'); break; }
      for (const a of list) {
        console.log(`\n${a.name} · ${a.title} · ${a.active ? 'approved' : a.off ? 'off' : 'NOT approved'}${a.purpose ? `\n  ${a.purpose}` : ''}`);
        for (const k of ['url', 'start', 'waiting']) if (a[k]) console.log(`  ${k}: ${a[k]}`);
        if (a.waitingNow) console.log(a.waitingNow.error ? `  waiting check failed: ${a.waitingNow.error}` : `  ${a.waitingNow.items.length} waiting${a.waitingNow.items.slice(0, 5).map((l) => `\n    · ${l}`).join('')}`);
      }
      if (list.some((a) => !a.active && !a.off)) console.log('\nRead the commands above, then approve one with: war-room addon --name NAME --approve');
    } catch (e) { console.error(e.message); process.exitCode = 1; }
    break;
  }
  case 'morning': {
    if (!store.exists()) { console.log('No war room here. Start one with /war-room.'); break; }
    try {
      const m = morningRun(store, { force: true });
      console.log(m?.run ? `Commander started (${m.run.id}). It is looking at: ${m.need.join(', ') || 'a general check'}. Log: ${m.run.log}` : m?.skipped || 'Nothing started.');
    } catch (e) { console.error(e.message); process.exitCode = 1; }
    break;
  }
  case 'daily': {
    // Make today's list and send the daily summary now (the watcher does this by itself once a day).
    if (!store.exists()) { console.log('No war room here. Start one with /war-room.'); break; }
    const text = dailyCheck(store, { force: true });
    notify(store, text);
    console.log(text);
    break;
  }
  case 'hook-session-start': {
    // Silent when the project has no war room: no clear goal, no war room.
    if (!store.exists()) break;
    const additionalContext = brief(store, process.env.WAR_ROOM_AGENT || 'unnamed chat (set WAR_ROOM_AGENT, or use the name the commander gave you)');
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }));
    break;
  }
  case 'hook-guard': {
    let input = {};
    try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch {}
    const reason = founderYesReason(input);
    const command = input.tool_input?.command;
    // Remote approvals (opt-in): the founder approves this exact command on the war-room page, once, within 30 min.
    if (reason && command && store.exists() && store.config().remoteApprovals === true) {
      const ok = consumeApproval(store, command);
      const out = ok
        ? { permissionDecision: 'allow', permissionDecisionReason: `War room: founder approved ${ok.id} for this exact command at ${ok.decided}.` }
        : (() => { const ap = requestApproval(store, { agent: process.env.WAR_ROOM_AGENT || 'unnamed chat', action: `${reason}: ${command}`, why: 'Asked by the guard before running it.', command });
          notify(store, `Approval needed: ${ap.id} ${reason}`);
          return { permissionDecision: 'deny', permissionDecisionReason: `War room: ${reason} needs the founder's yes. Request ${ap.id} is on the war-room page. Do other work; call check_approval with id ${ap.id} and run the exact same command again once it says approved.` }; })();
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...out } }));
      break;
    }
    if (reason) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: `War room: ${reason} needs the founder's yes for this exact action.`,
      } }));
      if (store.exists()) store.log({ agent: process.env.WAR_ROOM_AGENT, event: 'founder_yes_asked', reason });
    }
    break;
  }
  default:
    console.log(`war-room <command>
  up [--phone] [--no-open]        start the page and the watcher (one command)
  engine install [--project DIR]  keep your war rooms running in the background, from login (asks first)
  engine status | add | remove | uninstall   which war rooms the engine keeps running
  morning                         wake the commander now to work through what needs it
  doctor                          what is installed, connected and running
  status                          progress bars in the terminal
  spawn NAME [--agent claude|codex|gemini|cursor] [--model M]   start a worker chat
  runs                            worker chats and whether they still run
  debate "QUESTION" [--seats claude:opus,codex,gemini] [--rounds 2]   agents argue
  connect codex|gemini|cursor [--yes]   join another agent to the war room
  rules [--off sN --yes | --on sN --yes]   starter rules and your rules
  approve --id A --yes|--no · answer --question ID --text "..." · confirm-rules [--yes]
  addon [--name N --approve|--off] [--start]   your add-ons: list, approve, switch off, start
  daily                           make today's list and send the daily summary now
  tick --item N [--goal G] [--undo]   tick today's goal N yourself (one with no task behind it)
  read --note bN [--undo]             mark a shelf note read (moves your study bar)
  init · serve [--lan] · watch · dashboard · brief [--agent N] · call TOOL [JSON] · check-stale`);
}
