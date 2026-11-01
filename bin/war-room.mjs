#!/usr/bin/env node
// War room CLI: init, status, brief, call, and the hooks (session-start briefing, founder-yes guard).
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { Store, now, sign, userConfig, userDir } from '../server/store.mjs';
import { STARTER_RULES, starterRules } from '../server/starter-rules.mjs';
import { autoRemember, brief, callTool, consumeApproval, requestApproval, resolveApproval, ruleInForce } from '../server/tools.mjs';

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
  [/\bwar-room(\.mjs)?\b[^|;&\n]*\b(approve|answer|founder_answer|decide_goal|confirm-rules)\b|\bwar-room(\.mjs)?\b[^|;&\n]*\brules\s+--o(ff|n)\b|\.warroom\b|\bapprovals\.json\b|\.config\/war-room\b|\bWAR_ROOM_HOME\b/, 'approving, answering for the founder, or changing war-room files'],
  [/\b(firebase|vercel|netlify|fly|wrangler|eas|amplify)\b[^|;&]*\b(deploy|publish|submit)\b|--prod\b/, 'deploy'],
  [/\b(npm|pnpm|yarn)\s+publish\b|\bgh\s+release\s+create\b|\bgh\s+repo\s+create\b/, 'publishing'],
  [/\b(altool|notarytool|fastlane|transporter)\b|\bxcrun\s+altool\b/, 'App Store / TestFlight upload'],
  [/\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r|\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+--force)|\bdrop\s+(table|database)\b|\bfirestore:delete\b|\bgsutil\s+rm\b/i, 'deleting data'],
  [/api\.stripe\.com|\bstripe\s+(charges|payment|refunds|transfers|payouts)|\brevenuecat\b.*\b(grant|refund)\b/i, 'money'],
  [/\bsecurity\s+(find|add|delete)-(generic|internet)-password\b|\bgcloud\s+auth\b|\bgh\s+auth\b|\bnpm\s+(login|token)\b/, 'passwords or keys'],
  [/\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b/, 'running downloaded code'],
  [/\bclaude\s+(plugin|mcp)\s+(add|install)\b|\bnpx\s+skills?\s+add\b/, 'installing a skill, plugin or connector'],
];
const RISKY_TOOL = /(deploy|publish|delete|remove|trash|send_message|send_email|charge|payment|refund|purchase|transfer)/i;

function founderYesReason(input) {
  const name = input.tool_name || '';
  const ti = input.tool_input || {};
  if (name === 'Bash') {
    const hit = FOUNDER_YES.find(([re]) => re.test(ti.command || ''));
    return hit && hit[1];
  }
  if (['Write', 'Edit', 'MultiEdit'].includes(name) && /(^|\/)\.env(\.|$)|\.(pem|p8|p12|key)$/.test(ti.file_path || '')) return 'passwords or keys (secret file)';
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name) && /(^|\/)(\.warroom|\.config\/war-room)\//.test(ti.file_path || ti.notebook_path || '')) return 'editing war-room approvals, memory or settings by hand';
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
  if (cmd) execFile('/bin/sh', ['-c', `${cmd} "$1"`, 'warroom-notify', message], () => {});
}

function bar(pct, width = 20) {
  const n = Math.round((pct / 100) * width);
  return `${'█'.repeat(n)}${'░'.repeat(width - n)} ${String(pct).padStart(3)}%`;
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
    const out = callTool(store, rest[0], rest[1] ? JSON.parse(rest[1]) : {});
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
  case 'serve': {
    // The founder's page: answers, thoughts, approvals. 127.0.0.1 by default; --lan opens it to phones on the same
    // Wi-Fi, and then every request must carry the secret link token.
    if (!store.exists()) { console.log('No war room here. Start one with /war-room.'); break; }
    const http = await import('node:http');
    const crypto = await import('node:crypto');
    const os = await import('node:os');
    const { renderDashboard } = await import('../server/dashboard.mjs');
    const port = Number(flag('port', 4818));
    const lan = rest.includes('--lan');
    // A fresh secret link on every start; --keep-link reuses the last one (kept in the user folder, never the project).
    const keepFile = `${userDir()}/lan-link`;
    let token = rest.includes('--keep-link') && fs.existsSync(keepFile) ? fs.readFileSync(keepFile, 'utf8').trim() : crypto.randomBytes(24).toString('base64url');
    if (lan) fs.writeFileSync(keepFile, token, { mode: 0o600 });
    const tokenOk = (got) => !lan || (typeof got === 'string' && got.length === token.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(token)));
    const version = () => ['memory', 'goals', 'tasks', 'messages', 'approvals'].map((n) => { try { return fs.statSync(`${store.root}/${n}.json`).mtimeMs; } catch { return 0; } }).join('-')
      + (fs.existsSync(`${store.root}/log.jsonl`) ? fs.statSync(`${store.root}/log.jsonl`).mtimeMs : 0);
    const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    const actions = {
      '/api/answer': (b) => callTool(store, 'founder_answer', { agent: store.config().commander, questionId: String(b.questionId), founderWords: String(b.text) }),
      '/api/thought': (b) => {
        const out = callTool(store, 'post_message', { agent: 'founder', to: 'commander', kind: 'info', text: `Founder thought: ${b.text}` });
        if (!out.error) autoRemember(store, { kind: 'idea', text: String(b.text), source: 'founder' });
        return out;
      },
      '/api/approve': (b) => {
        try {
          const ap = resolveApproval(store, { id: String(b.id), yes: b.yes === true, by: 'founder (war-room page)' });
          callTool(store, 'post_message', { agent: 'founder', to: ap.agent, kind: 'info', text: `${ap.id} ${ap.status} by the founder: ${ap.action}` });
          return { text: 'ok' };
        } catch (e) { return { error: e.message }; }
      },
      '/api/goal': (b) => callTool(store, 'decide_goal', { agent: store.config().commander, goalId: String(b.goalId), choice: String(b.choice), founderWords: `chose "${b.choice}" on the war-room page` }),
    };
    http.createServer((req, res) => {
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
          if (['/api/answer', '/api/thought'].includes(url.pathname) && !String(b.text || '').trim()) return json(res, 400, { error: 'Empty.' });
          const out = actions[url.pathname](b);
          if (out.error) return json(res, 400, { error: out.error });
          notify(store, `Founder used the war-room page (${url.pathname.slice(5)}).`);
          return json(res, 200, { ok: true });
        });
        return;
      }
      res.writeHead(404); res.end('Not found');
    }).listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
      console.log(`War room page: http://127.0.0.1:${port}/${lan ? `?t=${token}` : ''}`);
      if (lan) {
        for (const nets of Object.values(os.networkInterfaces())) for (const n of nets || []) if (n.family === 'IPv4' && !n.internal) console.log(`On your phone (same Wi-Fi): http://${n.address}:${port}/?t=${token}`);
        console.log('Keep this link private: anyone on the same Wi-Fi with it can answer and approve.');
      }
    });
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
    console.log('\nSwitch a starter rule off: war-room rules --off s3 --yes · back on: --on s3 --yes');
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
  case 'watch': {
    if (!store.exists()) { console.log('No war room here. Start one with /war-room.'); break; }
    const mins = Number(flag('every', 60));
    const { renderDashboard } = await import('../server/dashboard.mjs');
    const redraw = () => { try { fs.writeFileSync(`${store.root}/dashboard.html`, renderDashboard(store)); } catch {} };
    console.log(`Watching ${store.root}: stale check every ${mins} min; file changes redraw the dashboard and notify instantly. Ctrl-C to stop.`);
    const pass = () => { const n = checkStale(store); if (n) notify(store, `${n} stale task(s) — alert in the commander's inbox.`); redraw(); };
    pass();
    setInterval(pass, mins * 60e3);
    let debounce;
    fs.watch(store.root, (ev, f) => {
      if (!f?.endsWith('.json') && f !== 'log.jsonl') return;
      if (f === 'config.json' || f === 'lock') return;
      clearTimeout(debounce);
      debounce = setTimeout(() => { redraw(); notify(store, `War room updated (${f}).`); }, 1500);
    });
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
    console.log('war-room init [--project NAME] [--commander NAME] | status | dashboard | serve [--port 4818] [--lan] [--keep-link] | confirm-rules [--yes] | approve --id A --yes|--no | brief [--agent NAME] | call TOOL [JSON] | check-stale | watch [--every MIN] | answer --question ID --text "..."');
}
