// The guard: which tool calls need the founder's yes, including what a script would run. It only ever adds a
// question; it cannot see everything (a program can build a command at run time), so what a chat is allowed to do
// (war-room access) is the stronger limit.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { consumeApproval, requestApproval } from './tools.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET_FILE = /(^|\/)(\.env(?!\.(example|sample|template|dist)$)(\.[\w-]+)?|id_(rsa|ed25519|ecdsa)|[^/]+\.(pem|p8|p12))$/;

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
  // The page's buttons (approve, install, answer) are for the founder; a chat posting to them is answering for them.
  [/\b(curl|wget|http|https|xh|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b[^|;&\n]*(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)[^|;&\n]*\/api\//i, 'pressing a button on the founder\'s war-room page'],
  [/\bwar-room(\.mjs)?\b[^|;&\n]*\bengine\s+(install|uninstall|add|remove|run)\b/, 'making something start by itself on this computer'],
  [/\bwar-room(\.mjs)?\b[^|;&\n]*\bkeep\s+(\S+\s+)*--yes\b/, 'making something start by itself on this computer'],
  // Each morning run is a paid commander run; the watcher starts one a day by itself.
  [/\bwar-room(\.mjs)?\b[^|;&\n]*\bmorning\b/, 'starting an extra paid commander run'],
  [/\bschtasks\b|\b(Register|New)-ScheduledTask\b|Start Menu[\\/]+Programs[\\/]+Startup|CurrentVersion[\\/]+Run(Once)?\b/i, 'making something start by itself on this computer'],
  [/\blaunchctl\s+(load|bootstrap|enable|submit|kickstart)\b|Library\/LaunchAgents\b|\bcrontab\b/, 'making something start by itself on this computer'],
  [/\bclaude\s+(plugin|mcp)\s+(add|install)\b|\b(npx|bunx|pnpx|dlx|exec)\b[^|;&\n]*\bskills?\s+(add|a)\b/, 'installing a skill, plugin or connector'],
  // A command hidden behind a variable cannot be read, so it asks.
  [/\bgit(\s+-[Cc]\s+("[^"]*"|'[^']*'|[^\s|;&]+)|\s+-(?![Cc]\s)[^\s|;&]+)*\s+["']?\$[{(\w]/, 'a git command hidden in a variable'],
  [/\b(curl|wget|xh|httpie?)\b(?![^|;&\n]*(127\.0\.0\.1|localhost|\[::1\]))[^|;&\n]*(\s(-X\s*|--request[\s=]+|--method[\s=]+)["']?DELETE\b)|\b(Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b[^|;&\n]*-Method\s+["']?Delete\b/i, 'deleting data'],
  [/\bRemove-Item\b[^|;&\n]*-Recurse|\b(rmdir|rd)\s+\/s\b|\bdel\s+\/s\b/i, 'deleting data'],
  // Code typed straight into an interpreter that deletes files or starts other programs.
  [/\b(python3?|node|ruby|perl|deno|bun)\b(?=[\s\S]*(\s(-c|-e|-p|--eval|--print)[\s=]|\beval\s|<<))[\s\S]*\b(rmtree|rmSync|rmdirSync|unlinkSync|fs(\/promises)?['")]*\.(rm|unlink|rmdir)|os\.(remove|unlink|rmdir)|FileUtils\.rm|\.unlink\()/, 'deleting data'],
  [/\b(python3?|node|ruby|perl|deno|bun)\b(?=[\s\S]*(\s(-c|-e|-p|--eval|--print)[\s=]|<<))[\s\S]*\b(child_process|execSync|spawnSync|subprocess|os\.system|os\.popen)\b/, 'running hidden commands from typed code'],
  // Secret files: reading or copying them. Example files are fine.
  [/(^|[|;&\n(]\s*)(cat|head|tail|less|more|grep|rg|awk|sed|cut|sort|strings|xxd|base64|cp|mv|scp|source|\.|type|Get-Content|gc)\s[^|;&\n]*(\.env(?!\.(example|sample|template|dist))(\.[\w-]+)?(?![\w.-])|\bid_(rsa|ed25519|ecdsa)(?![\w.])|\.(pem|p8|p12)(?![\w.]))/, 'passwords or keys (secret file)'],
  // Another agent's own safety settings.
  [/(>|\btee\b|\bsed\s+-i|\bcp\b|\bmv\b|\brm\b|\bSet-Content\b)[^|;&\n]*[\\/]?\.(codex[\\/]+config\.toml|gemini[\\/]+settings\.json|cursor[\\/]+(mcp|cli-config)\.json)/, 'changing an agent\'s safety settings'],
  // Giving a chat more room is the founder's decision.
  [/\bwar-room(\.mjs)?\b[^|;&\n]*\baccess\s+[\w.-]+\s+(read|edit|run)\b/, 'changing what a team member may do'],
];
const RISKY_TOOL = /(deploy|publish|delete|remove|trash|send_message|send_email|charge|payment|refund|purchase|transfer)/i;

export function founderYesReason(input) {
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
    if (hit) return hit[1];
    return scriptReason(command, input.cwd || process.cwd());
  }
  if (['Read', 'Grep'].includes(name) && SECRET_FILE.test(String(ti.file_path || ti.path || '').replace(/\\/g, '/'))) return 'passwords or keys (secret file)';
  if (['Write', 'Edit', 'MultiEdit'].includes(name) && /(^|\/)\.(codex\/config\.toml|gemini\/settings\.json|cursor\/(mcp|cli-config)\.json)$/.test(ti.file_path || '')) return 'changing an agent\'s safety settings';
  if (['Write', 'Edit', 'MultiEdit'].includes(name) && /(^|\/)\.env(\.|$)|\.(pem|p8|p12|key)$/.test(ti.file_path || '')) return 'passwords or keys (secret file)';
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name) && /(^|\/)(\.warroom|\.config\/war-room)\//.test(ti.file_path || ti.notebook_path || '')) return 'editing war-room approvals, memory or settings by hand';
  if (['Write', 'Edit', 'MultiEdit'].includes(name) && /\/Library\/LaunchAgents\/|Start Menu\/Programs\/Startup\//i.test(ti.file_path || '')) return 'making something start by itself on this computer';
  if (['Write', 'Edit', 'MultiEdit'].includes(name) && /(^|\/)\.claude\/(settings[^/]*\.json|plugins\/)|(^|\/)hooks\/hooks\.json$/.test(ti.file_path || '')) return 'switching off or changing the safety guard';
  if (name.startsWith('mcp__') && !name.includes('war-room') && RISKY_TOOL.test(name.split('__').pop())) return 'an outside action (send, delete, publish or pay)';
  return null;
}

// ── Reading inside scripts ───────────────────────────
// "npm run ship" or "./release.sh" hides what runs. Open the script and apply the same rules to its lines.
const NOT_IN_SCRIPTS = /^(approving, answering|taking, reporting)/;

function readSmall(file) {
  try { const st = fs.statSync(file); return st.isFile() && st.size <= 200 * 1024 ? fs.readFileSync(file, 'utf8') : null; } catch { return null; }
}

function textReason(text) {
  const lines = text.replace(/\\\r?\n/g, ' ').split(/\r?\n/).filter((l) => !/^\s*(#|::|REM\b|\/\/)/i.test(l));
  for (const line of lines) {
    const hit = FOUNDER_YES.find(([re, why]) => !NOT_IN_SCRIPTS.test(why) && re.test(line));
    if (hit) return hit[1];
  }
  return null;
}

export function scriptReason(command, cwd, depth = 0, seen = new Set()) {
  if (depth > 3) return null;
  let dir = cwd;
  for (const part of String(command).split(/&&|\|\||;|\||\n/)) {
    const seg = part.trim().replace(/^(\w+=\S*\s+)+/, '').replace(/^(sudo|time|nohup|env|exec)\s+/, '');
    const cd = seg.match(/^cd\s+(["']?)([^"']+)\1\s*$/);
    if (cd) { dir = path.resolve(dir, cd[2]); continue; }
    // Package scripts, with their pre and post steps.
    const pm = seg.match(/^(npm|pnpm|yarn|bun)\s+((?:(?:--prefix|--dir|-C|--cwd)[\s=]+\S+\s+|-{1,2}[\w-]+\s+)*)(?:(run|run-script)\s+)?([\w:.-]+)/);
    if (pm) {
      const at = pm[2].match(/(?:--prefix|--dir|-C|--cwd)[\s=]+(["']?)([^\s"']+)\1/);
      const base = at ? path.resolve(dir, at[2]) : dir;
      let scripts = {};
      try { scripts = JSON.parse(readSmall(path.join(base, 'package.json')) || '{}').scripts || {}; } catch { return `a script that could not be read (${path.join(base, 'package.json')})`; }
      const name = pm[4] === 't' ? 'test' : pm[4];
      if (scripts[name]) {
        if (/(^|[:._-])(deploy|publish|release)([:._-]|$)/i.test(name)) return `deploy or publishing (script "${name}")`;
        for (const n of [`pre${name}`, name, `post${name}`]) {
          const body = scripts[n];
          const key = `${base}:${n}`;
          if (!body || seen.has(key)) continue;
          seen.add(key);
          const why = textReason(body) || scriptReason(body, base, depth + 1, seen);
          if (why) return `${why} (inside script "${n}": ${String(body).slice(0, 120)})`;
        }
      }
      continue;
    }
    // Shell and PowerShell script files, run directly or through a shell.
    const sh = seg.match(/^(?:(?:ba|z|da|k)?sh|source|\.|pwsh|powershell(?:\.exe)?|cmd(?:\.exe)?\s+\/c)\s+(?:-(?!c\b)[\w-]+\s+)*(["']?)([^\s"']+)\1/i)
      || seg.match(/^(["']?)((?:\.{1,2}|~)?[\\/][^\s"']+|[^\s"']+\.(?:sh|bash|zsh|ps1|cmd|bat))\1(?=\s|$)/i);
    if (sh) {
      const file = path.resolve(dir, sh[2]);
      if (seen.has(file) || file.startsWith(PLUGIN_ROOT + path.sep)) continue;
      seen.add(file);
      const body = readSmall(file);
      if (body === null || body.includes('\u0000')) continue;
      // A program file with another language's first line is not a shell script.
      if (/^#!.*\b(node|python|ruby|perl)/.test(body)) continue;
      const why = textReason(body) || scriptReason(body, dir, depth + 1, seen);
      if (why) return `${why} (inside ${path.basename(file)})`;
    }
  }
  return null;
}

// ── The hook itself ──────────────────────────────────
const decision = (permissionDecision, permissionDecisionReason) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason } });

export function runGuard(input, { store, notify = () => {} }) {
  const reason = founderYesReason(input);
  if (!reason) return '';
  const command = input.tool_input?.command;
  // Remote approvals (opt-in): the founder approves this exact command on the war-room page, once, within 30 min.
  if (command && store.exists() && store.config().remoteApprovals === true) {
    const ok = consumeApproval(store, command);
    if (ok) return decision('allow', `War room: founder approved ${ok.id} for this exact command at ${ok.decided}.`);
    const ap = requestApproval(store, { agent: process.env.WAR_ROOM_AGENT || 'unnamed chat', action: `${reason}: ${command}`, why: 'Asked by the guard before running it.', command });
    notify(store, `Approval needed: ${ap.id} ${reason}`);
    return decision('deny', `War room: ${reason} needs the founder's yes. Request ${ap.id} is on the war-room page. Do other work; call check_approval with id ${ap.id} and run the exact same command again once it says approved.`);
  }
  if (store.exists()) store.log({ agent: process.env.WAR_ROOM_AGENT, event: 'founder_yes_asked', reason });
  return decision('ask', `War room: ${reason} needs the founder's yes for this exact action.`);
}

// A guard that breaks must block, not wave things through. Exit code 2 is the only failure that stops the tool call.
export async function runGuardSafely(raw, opts) {
  try {
    const input = JSON.parse(raw);
    if (!input || typeof input !== 'object' || !input.tool_name) throw new Error('the request had no tool name');
    const out = runGuard(input, opts);
    if (out) process.stdout.write(out);
    return 0;
  } catch (e) {
    process.stderr.write(`War room guard could not check this action, so it is blocked: ${e.message}. Tell the founder. To work without the guard they can switch the war-room plugin off.\n`);
    return 2;
  }
}
