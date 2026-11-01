#!/usr/bin/env node
// War room CLI: init, status, brief, call, and the hooks (session-start briefing, founder-yes guard).
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { Store, now } from '../server/store.mjs';
import { brief, callTool } from '../server/tools.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, dflt) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : dflt; };
const store = new Store();

// Actions that always need the founder's yes at that step, whatever permissions the agent has.
const FOUNDER_YES = [
  [/\bgit\s+push\b/, 'git push'],
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
  if (posted) store.log({ agent: 'war-room-watch', event: 'stale_alert', count: posted });
  return posted;
}

// The founder's own notifier (e.g. a push script). Set "notifyCommand" in .warroom/config.json; it gets the message as one argument.
function notify(store, message) {
  console.log(`${now()} ${message}`);
  const cmd = store.config().notifyCommand;
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
  case 'check-stale': {
    if (!store.exists()) { console.log('No war room here.'); break; }
    const n = checkStale(store);
    console.log(n ? `${n} stale task alert(s) posted to the commander's inbox.` : 'No stale tasks.');
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
    console.log(`Watching ${store.root}: stale check every ${mins} min; file changes notify instantly. Ctrl-C to stop.`);
    const pass = () => { const n = checkStale(store); if (n) notify(store, `${n} stale task(s) — alert in the commander's inbox.`); };
    pass();
    setInterval(pass, mins * 60e3);
    let debounce;
    fs.watch(store.root, (ev, f) => {
      if (!f?.endsWith('.json') || f === 'config.json') return;
      clearTimeout(debounce);
      debounce = setTimeout(() => notify(store, `War room updated (${f}).`), 1500);
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
    console.log('war-room init [--project NAME] [--commander NAME] | status | brief [--agent NAME] | call TOOL [JSON] | check-stale | watch [--every MIN] | answer --question ID --text "..."');
}
