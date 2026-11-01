// War room tools. The MCP server and the CLI both call these, so every agent sees the same rules.
import { MEMORY_KINDS, nextId, now, overlap, words } from './store.mjs';

const str = (description) => ({ type: 'string', description });
const strList = (description) => ({ type: 'array', items: { type: 'string' }, description });
const AGENT = str('Your agent name, e.g. "claude-frontend" or "codex". The commander uses the name set at init.');

class Refused extends Error {}

function needCommander(store, agent) {
  const { commander } = store.config();
  if (agent !== commander) throw new Refused(`Only the commander ("${commander}") can do this. Ask it with post_message.`);
}

function today() {
  return now().slice(0, 10);
}

function cfgNum(store, key, dflt) {
  const v = store.config()[key];
  return Number.isFinite(v) ? v : dflt;
}

// Claimed long ago with no report: the chat probably died and its files stay locked.
function staleTasks(store, tasks) {
  const cutoff = Date.now() - cfgNum(store, 'staleHours', 2) * 3600e3;
  return tasks.filter((t) => t.status === 'claimed' && new Date(t.claimed).getTime() < cutoff);
}

function todayEvents(store) {
  const counts = {};
  for (const e of store.readLog(100000)) if (e.at?.startsWith(today()) && e.agent) counts[e.agent] = (counts[e.agent] || 0) + 1;
  return counts;
}

function overBudget(store) {
  const budget = cfgNum(store, 'dailyEventBudget', 300);
  return { budget, agents: Object.entries(todayEvents(store)).filter(([, n]) => n > budget) };
}

function progress(goal, tasks) {
  const checks = (goal.milestones || []).flatMap((m) => m.checks || []);
  const verified = checks.filter((c) => c.verified).length;
  const todayItems = (goal.daily?.[today()] || []).map((it) => {
    const t = tasks.find((x) => x.id === it.taskId);
    return { ...it, done: t ? t.status === 'verified' : !!it.done };
  });
  return {
    goal: goal.id,
    title: goal.title,
    status: goal.status,
    percent: checks.length ? Math.round((verified / checks.length) * 100) : 0,
    verifiedChecks: `${verified}/${checks.length}`,
    milestones: (goal.milestones || []).map((m) => ({
      id: m.id,
      title: m.title,
      percent: m.checks?.length ? Math.round((m.checks.filter((c) => c.verified).length / m.checks.length) * 100) : 0,
    })),
    today: todayItems,
  };
}

function relevantMemory(memory, text, limit, anyKind = false) {
  return memory
    .filter((m) => m.status === 'active' && (anyKind || !['rule', 'never', 'question'].includes(m.kind)))
    .map((m) => ({ m, score: overlap(m.text, text) + (m.tags || []).filter((t) => words(text).includes(t.toLowerCase())).length * 2 }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.m);
}

export function brief(store, agent) {
  const cfg = store.config();
  const memory = store.read('memory');
  const tasks = store.read('tasks');
  const goals = store.read('goals');
  const messages = store.read('messages');
  const out = [`# WAR ROOM · ${cfg.project} · ${now()} · you are: ${agent || 'unknown'}${agent === cfg.commander ? ' (COMMANDER)' : ''}`];
  const rules = memory.filter((m) => m.status === 'active' && (m.kind === 'rule' || m.kind === 'never'));
  if (rules.length) out.push('', '## Rules (founder; always apply)', ...rules.map((m) => `- [${m.id}] ${m.text}`));
  const mine = tasks.filter((t) => t.agent === agent && ['claimed', 'open', 'rejected'].includes(t.status));
  if (mine.length) {
    out.push('', '## Your task');
    for (const t of mine.slice(0, 2)) out.push(packetText(t, goals, memory));
  } else if (agent !== cfg.commander) {
    out.push('', 'No task for you yet. Call get_task_packet, or wait for the commander.');
  }
  const inbox = messages.filter((m) => m.open && (m.to === agent || m.to === 'all')).slice(-5);
  if (inbox.length) out.push('', '## Messages for you', ...inbox.map((m) => `- #${m.id} from ${m.from} [${m.kind}]: ${m.text.slice(0, 200)}`));
  if (agent === cfg.commander) {
    const active = goals.filter((g) => !['done', 'dropped'].includes(g.status));
    if (active.length) out.push('', '## Goals', ...active.map((g) => { const p = progress(g, tasks); return `- ${g.id} [${g.status}] ${g.title} — ${p.percent}% (${p.verifiedChecks} checks verified)`; }));
    const waiting = tasks.filter((t) => t.status === 'reported');
    if (waiting.length) out.push('', '## Reports waiting for you to verify', ...waiting.map((t) => `- ${t.id} by ${t.agent}: ${t.title}`));
    const qs = memory.filter((m) => m.kind === 'question' && m.status === 'active');
    if (qs.length) out.push('', '## Waiting on the founder', ...qs.map((m) => `- [${m.id}] ${m.text}`));
    const stale = staleTasks(store, tasks);
    if (stale.length) out.push('', '## Stale tasks (claimed, no report — the chat may be dead; nudge it or reassign_task)', ...stale.map((t) => `- ${t.id} ${t.title} — claimed by ${t.agent} at ${t.claimed}`));
    const over = overBudget(store);
    if (over.agents.length) out.push('', `## Possible loop: past today's action cap (${over.budget})`, ...over.agents.map(([ag, n]) => `- ${ag}: ${n} actions today. This is a loop guard, not a money budget (spending is capped by the founder's own plan). Check it is not stuck before giving it more work; raise dailyEventBudget in .warroom/config.json if this pace is expected.`));
  }
  out.push('', 'Safety: pushes, deploys, publishing, deleting data, money and keys each need the founder\'s yes at that step. If your platform has approval settings for such actions, keep them on.');
  out.push('', 'Memory and the full plan live in the war room: use recall / war_room_status, never ask the founder what memory already answers.');
  const text = out.join('\n');
  return text.length > 6000 ? `${text.slice(0, 5950)}\n… (cut; call war_room_status)` : text;
}

function packetText(t, goals, memory) {
  const g = goals.find((x) => x.id === t.goalId);
  const rules = (t.rules || []).map((id) => memory.find((m) => m.id === id)).filter(Boolean);
  const extra = relevantMemory(memory, `${t.title} ${t.doneCheck} ${(t.tags || []).join(' ')}`, 6 - rules.length);
  return [
    `### ${t.id} · ${t.title} [${t.status}]`,
    g ? `Goal: ${g.title}` : null,
    t.files?.length ? `You may change only: ${t.files.join(', ')}` : t.area ? `Area: ${t.area}` : null,
    `Done means: ${t.doneCheck}`,
    t.rejectNote ? `Commander rejected the last report: ${t.rejectNote}` : null,
    ...[...rules, ...extra].map((m) => `- relevant ${m.kind} [${m.id}]: ${m.text}`),
    'When finished: report_done with the evidence (command output, file, screenshot path). The commander verifies before it counts.',
  ].filter(Boolean).join('\n');
}

export const TOOLS = [
  {
    name: 'war_room_brief',
    description: 'Short briefing for this agent: founder rules, your task packet, your messages. Call it first in every session.',
    inputSchema: { type: 'object', properties: { agent: AGENT }, required: ['agent'] },
    run: (store, a) => brief(store, a.agent),
  },
  {
    name: 'war_room_status',
    description: 'Progress bars: each goal with % of verified checks, milestones, today\'s goals, every agent\'s task, and the last 10 log events.',
    inputSchema: { type: 'object', properties: {} },
    run: (store) => {
      const tasks = store.read('tasks');
      const goals = store.read('goals').filter((g) => g.status !== 'dropped');
      const agents = {};
      for (const t of tasks.filter((x) => x.status !== 'verified')) (agents[t.agent || 'unassigned'] ||= []).push(`${t.id} ${t.title} [${t.status}]`);
      return { goals: goals.map((g) => progress(g, tasks)), agents, log: store.readLog(10) };
    },
  },
  {
    name: 'remember',
    description: 'Store one thing the founder said or decided. kind: rule (hard rule, shown to every agent), never (mistake not to repeat), decision, pref, fact, question (waiting on the founder). If it may conflict with an older item, nothing is stored and the conflicts are returned: ask the founder, then call again with replaces=<old id> or keepBoth=true.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: AGENT,
        kind: { type: 'string', enum: MEMORY_KINDS },
        text: str('One plain sentence. Never store passwords, keys or card numbers.'),
        source: str('Who said it and where, e.g. "founder in chat".'),
        tags: strList('A few topic words, e.g. ["payments","launch"].'),
        replaces: str('Id of the older item this replaces.'),
        keepBoth: { type: 'boolean', description: 'Store even though similar items exist.' },
      },
      required: ['agent', 'kind', 'text'],
    },
    run: (store, a) => {
      if (/(sk-[a-z0-9]{10,}|AKIA[0-9A-Z]{12,}|-----BEGIN|\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b|password\s*[:=])/i.test(a.text)) {
        throw new Refused('This looks like a secret (key, password or card number). The war room never stores secrets.');
      }
      return store.update('memory', (memory) => {
        if (!a.replaces && !a.keepBoth) {
          const conflicts = memory.filter((m) => m.status === 'active' && m.kind !== 'question' && overlap(m.text, a.text) >= 3);
          if (conflicts.length) {
            return { stored: false, askFounder: `You said: "${a.text}". Earlier: ${conflicts.map((c) => `[${c.id}] ${c.date}: "${c.text}"`).join('; ')}. Replace the earlier one, or keep both?`, conflicts };
          }
        }
        const item = { id: nextId(memory, 'm'), kind: a.kind, text: a.text, date: now(), source: a.source || a.agent, tags: a.tags || [], status: 'active' };
        if (a.replaces) {
          const old = memory.find((m) => m.id === a.replaces);
          if (!old) throw new Refused(`No memory item ${a.replaces}.`);
          old.status = 'replaced';
          old.replacedBy = item.id;
          item.replaces = old.id;
        }
        memory.push(item);
        store.log({ agent: a.agent, event: 'remember', id: item.id, kind: item.kind, text: item.text });
        return { stored: true, item };
      });
    },
  },
  {
    name: 'recall',
    description: 'Search the long-term memory before asking the founder anything. Returns active items that match, newest first, with replaced history on request.',
    inputSchema: { type: 'object', properties: { query: str('What you want to know.'), kinds: strList('Limit to these kinds.'), includeReplaced: { type: 'boolean' } }, required: ['query'] },
    run: (store, a) => {
      const memory = store.read('memory');
      const hits = memory
        .filter((m) => (a.includeReplaced || m.status === 'active') && (!a.kinds?.length || a.kinds.includes(m.kind)))
        .map((m) => ({ ...m, score: overlap(m.text, a.query) + (m.tags || []).filter((t) => words(a.query).includes(t.toLowerCase())).length * 2 }))
        .filter((m) => m.score > 0)
        .sort((x, y) => y.score - x.score || y.date.localeCompare(x.date))
        .slice(0, 12);
      return hits.length ? hits : 'Nothing in memory matches. If it matters, ask the founder with ask_founder.';
    },
  },
  {
    name: 'ask_founder',
    description: 'Queue one plain question for the founder (one decision, with your suggested answer). Refused if memory already answers it.',
    inputSchema: {
      type: 'object',
      properties: { agent: AGENT, question: str('One decision, plain words.'), suggested: str('Your suggested answer.'), whatChanged: str('Only when re-asking: what changed since the earlier answer.') },
      required: ['agent', 'question', 'suggested'],
    },
    run: (store, a) => store.update('memory', (memory) => {
      if (!a.whatChanged) {
        const known = memory.filter((m) => m.status === 'active' && overlap(m.text, a.question) >= Math.max(3, Math.ceil(words(a.question).length * 0.5)));
        if (known.length) return { queued: false, reason: 'Memory already covers this. Use it; re-ask only with whatChanged.', known };
      }
      const item = { id: nextId(memory, 'm'), kind: 'question', text: `${a.question} (suggested: ${a.suggested})`, date: now(), source: a.agent, tags: [], status: 'active' };
      memory.push(item);
      store.log({ agent: a.agent, event: 'ask_founder', id: item.id, text: a.question });
      return { queued: true, item };
    }),
  },
  {
    name: 'founder_answer',
    description: 'Commander only: record the founder\'s answer to a queued question. It becomes a decision in memory.',
    inputSchema: { type: 'object', properties: { agent: AGENT, questionId: str('Id of the question item.'), founderWords: str('The founder\'s answer, quoted.') }, required: ['agent', 'questionId', 'founderWords'] },
    run: (store, a) => {
      needCommander(store, a.agent);
      return store.update('memory', (memory) => {
        const q = memory.find((m) => m.id === a.questionId && m.kind === 'question');
        if (!q) throw new Refused(`No question ${a.questionId}.`);
        const item = { id: nextId(memory, 'm'), kind: 'decision', text: `Q: ${q.text} → A: ${a.founderWords}`, date: now(), source: 'founder', tags: q.tags, status: 'active', replaces: q.id };
        q.status = 'replaced';
        q.replacedBy = item.id;
        memory.push(item);
        store.log({ agent: a.agent, event: 'founder_answer', id: item.id });
        return item;
      });
    },
  },
  {
    name: 'propose_goal',
    description: 'Start a new goal or idea from the founder. It starts in "intake": the commander asks the missing intake questions (what, for whom, by when, what done looks like, what must never happen), then judges it.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: AGENT,
        title: str('The idea in one plain line.'),
        founderWords: str('What the founder actually said.'),
        what: str('What it is.'), forWhom: str('Who it is for.'), byWhen: str('Deadline, if any.'), doneLooksLike: str('How we will know it is done.'), mustNever: str('What must never happen.'),
      },
      required: ['agent', 'title', 'founderWords'],
    },
    run: (store, a) => {
      const memory = store.read('memory');
      return store.update('goals', (goals) => {
        const intake = { what: a.what, forWhom: a.forWhom, byWhen: a.byWhen, doneLooksLike: a.doneLooksLike, mustNever: a.mustNever };
        const missing = Object.entries(intake).filter(([, v]) => !v).map(([k]) => k);
        const g = { id: nextId(goals, 'g'), title: a.title, founderWords: a.founderWords, intake, status: 'intake', created: now(), milestones: [], daily: {} };
        goals.push(g);
        store.log({ agent: a.agent, event: 'propose_goal', id: g.id, title: g.title });
        const related = relevantMemory(memory, `${a.title} ${a.founderWords}`, 8, true).map(({ id, kind, date, text }) => ({ id, kind, date, text }));
        return { goal: g, askFounderFirst: missing, relatedMemory: related, remind: related.length ? 'Before judging, show the founder anything in relatedMemory they seem to have forgotten (quote the date and their words).' : undefined };
      });
    },
  },
  {
    name: 'judge_goal',
    description: 'Commander only: judge and improve a goal before any planning. Fill every field honestly; for big goals (money, launch, legal, a new milestone) run the court/council skills first and put their blind-spot lists here.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: AGENT, goalId: str('Goal id.'),
        fit: str('How it serves (or distracts from) the main goal.'),
        cost: str('Time, money and attention it needs.'),
        risks: str('What could go wrong.'),
        conflicts: strList('Memory ids it conflicts with, with one line each.'),
        strongerVersion: str('The improved version you would build instead, or "none".'),
        founderMayNotSee: strList('Blind spots on the founder side.'),
        aiMayNotSee: strList('Blind spots on the AI side.'),
        recommendation: { type: 'string', enum: ['keep', 'improve', 'later', 'drop'] },
        reason: str('One plain sentence.'),
      },
      required: ['agent', 'goalId', 'fit', 'cost', 'risks', 'strongerVersion', 'recommendation', 'reason'],
    },
    run: (store, a) => {
      needCommander(store, a.agent);
      return store.update('goals', (goals) => {
        const g = goals.find((x) => x.id === a.goalId);
        if (!g) throw new Refused(`No goal ${a.goalId}.`);
        const { agent, goalId, ...verdict } = a;
        g.verdict = { ...verdict, date: now() };
        g.status = 'judged';
        store.log({ agent, event: 'judge_goal', id: g.id, recommendation: a.recommendation });
        return { goal: g, nextStep: `Show the founder: keep / improved version / later / drop (you recommend "${a.recommendation}"). Record their choice with decide_goal.` };
      });
    },
  },
  {
    name: 'decide_goal',
    description: 'Commander only: record the founder\'s choice on a judged goal. Planning is allowed only after "keep" or "improve".',
    inputSchema: {
      type: 'object',
      properties: { agent: AGENT, goalId: str('Goal id.'), choice: { type: 'string', enum: ['keep', 'improve', 'later', 'drop'] }, founderWords: str('The founder\'s words, quoted.') },
      required: ['agent', 'goalId', 'choice', 'founderWords'],
    },
    run: (store, a) => {
      needCommander(store, a.agent);
      return store.update('goals', (goals) => {
        const g = goals.find((x) => x.id === a.goalId);
        if (!g) throw new Refused(`No goal ${a.goalId}.`);
        if (g.status !== 'judged') throw new Refused('Judge the goal (judge_goal) before the founder decides.');
        if (a.choice === 'improve' && g.verdict?.strongerVersion && g.verdict.strongerVersion !== 'none') g.title = g.verdict.strongerVersion;
        g.status = { keep: 'approved', improve: 'approved', later: 'later', drop: 'dropped' }[a.choice];
        g.decision = { choice: a.choice, founderWords: a.founderWords, date: now() };
        store.log({ agent: a.agent, event: 'decide_goal', id: g.id, choice: a.choice });
        return g;
      });
    },
  },
  {
    name: 'set_plan',
    description: 'Commander only: set milestones for an approved goal. Each milestone has a win condition and checks; progress counts only verified checks.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: AGENT, goalId: str('Goal id.'),
        milestones: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, win: { type: 'string' }, checks: { type: 'array', items: { type: 'string' } } }, required: ['title', 'win', 'checks'] } },
      },
      required: ['agent', 'goalId', 'milestones'],
    },
    run: (store, a) => {
      needCommander(store, a.agent);
      return store.update('goals', (goals) => {
        const g = goals.find((x) => x.id === a.goalId);
        if (!g) throw new Refused(`No goal ${a.goalId}.`);
        if (!['approved', 'active'].includes(g.status)) throw new Refused(`Goal is "${g.status}": the founder must approve it (decide_goal) before planning.`);
        const kept = new Map((g.milestones || []).flatMap((m) => m.checks).map((c) => [c.text, c]));
        g.milestones = a.milestones.map((m, i) => ({
          id: `${g.id}.m${i + 1}`, title: m.title, win: m.win,
          checks: m.checks.map((text, j) => kept.get(text) || { id: `${g.id}.m${i + 1}.c${j + 1}`, text, verified: false }),
        }));
        g.status = 'active';
        store.log({ agent: a.agent, event: 'set_plan', id: g.id, milestones: g.milestones.length });
        return g;
      });
    },
  },
  {
    name: 'set_today',
    description: 'Commander only: set today\'s goals for a goal (short list, each optionally linked to a task).',
    inputSchema: { type: 'object', properties: { agent: AGENT, goalId: str('Goal id.'), items: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, taskId: { type: 'string' } }, required: ['text'] } } }, required: ['agent', 'goalId', 'items'] },
    run: (store, a) => {
      needCommander(store, a.agent);
      return store.update('goals', (goals) => {
        const g = goals.find((x) => x.id === a.goalId);
        if (!g) throw new Refused(`No goal ${a.goalId}.`);
        (g.daily ||= {})[today()] = a.items;
        return { date: today(), items: a.items };
      });
    },
  },
  {
    name: 'create_task',
    description: 'Commander only: hand one piece of work to one agent as a task packet (files it may touch, the done check, the relevant rules).',
    inputSchema: {
      type: 'object',
      properties: {
        agent: AGENT, goalId: str('Goal id.'), checkId: str('The milestone check this task proves, if any.'),
        title: str('What to do, one line.'), assignTo: str('Agent name that should do it.'),
        files: strList('Paths or folders it may change.'), area: str('Area name, if no file list.'),
        doneCheck: str('The command, file or screen that proves it is done.'),
        rules: strList('Memory ids that apply.'), tags: strList('Topic words to pull more memory.'),
        model: str('Suggested model tier for the worker chat: "strong" (design, architecture, risky changes) or "cheap" (mechanical, well-specified work). The founder or dispatcher picks the actual model when starting the chat.'),
      },
      required: ['agent', 'goalId', 'title', 'assignTo', 'doneCheck'],
    },
    run: (store, a) => {
      needCommander(store, a.agent);
      const goal = store.read('goals').find((g) => g.id === a.goalId);
      if (!goal || goal.status !== 'active') throw new Refused('Tasks need an active goal with a plan (set_plan).');
      const memory = store.read('memory');
      return store.update('tasks', (tasks) => {
        const clash = (a.files || []).length && tasks.find((t) => !['verified'].includes(t.status) && t.agent !== a.assignTo && (t.files || []).some((f) => a.files.some((g) => f.startsWith(g) || g.startsWith(f))));
        if (clash) throw new Refused(`${clash.agent} is already working on overlapping files (${clash.id}). One writer per file: wait or pick other files.`);
        const t = { id: nextId(tasks, 't'), goalId: a.goalId, checkId: a.checkId, title: a.title, agent: a.assignTo, files: a.files || [], area: a.area, doneCheck: a.doneCheck, rules: a.rules || [], tags: a.tags || [], model: a.model, status: 'open', created: now() };
        tasks.push(t);
        store.log({ agent: a.agent, event: 'create_task', id: t.id, to: t.agent, title: t.title });
        const missedMemory = relevantMemory(memory, `${t.title} ${t.doneCheck} ${(t.tags || []).join(' ')}`, 6, true).filter((m) => !t.rules.includes(m.id)).map(({ id, kind, date, text }) => ({ id, kind, date, text }));
        return { task: t, missedMemory, remind: missedMemory.length ? 'Memory items that match this task but are not in its rules — add any that apply (they also ride along in the packet automatically).' : undefined };
      });
    },
  },
  {
    name: 'reassign_task',
    description: 'Commander only: move a stuck or dead task to another agent. Clears the stale claim so its files are free again; the task history stays.',
    inputSchema: { type: 'object', properties: { agent: AGENT, taskId: str('Task id.'), assignTo: str('The agent that takes it over.'), reason: str('Why, one line (e.g. "claimed 3h ago, no report").') }, required: ['agent', 'taskId', 'assignTo', 'reason'] },
    run: (store, a) => {
      needCommander(store, a.agent);
      return store.update('tasks', (tasks) => {
        const t = tasks.find((x) => x.id === a.taskId);
        if (!t) throw new Refused(`No task ${a.taskId}.`);
        if (t.status === 'verified') throw new Refused(`${t.id} is already verified.`);
        (t.history ||= []).push({ from: t.agent, status: t.status, reason: a.reason, date: now() });
        Object.assign(t, { agent: a.assignTo, status: 'open', claimed: undefined });
        store.log({ agent: a.agent, event: 'reassign', id: t.id, to: a.assignTo, reason: a.reason });
        return t;
      });
    },
  },
  {
    name: 'get_task_packet',
    description: 'Worker agents: get your next task with only the context you need. Claims it for you.',
    inputSchema: { type: 'object', properties: { agent: AGENT }, required: ['agent'] },
    run: (store, a) => {
      const goals = store.read('goals');
      const memory = store.read('memory');
      return store.update('tasks', (tasks) => {
        const t = tasks.find((x) => x.agent === a.agent && ['claimed', 'rejected'].includes(x.status)) || tasks.find((x) => x.agent === a.agent && x.status === 'open');
        if (!t) return 'No task for you. Wait for the commander or post_message to it.';
        if (t.status === 'open') { t.status = 'claimed'; t.claimed = now(); store.log({ agent: a.agent, event: 'claim', id: t.id }); }
        return packetText(t, goals, memory);
      });
    },
  },
  {
    name: 'report_done',
    description: 'Worker agents: report a task finished, with evidence. It counts only after the commander verifies it.',
    inputSchema: { type: 'object', properties: { agent: AGENT, taskId: str('Task id.'), summary: str('What you did, plainly.'), evidence: str('Command + output, file path, or screenshot path that proves the done check.'), notVerified: str('Anything you could not check.') }, required: ['agent', 'taskId', 'summary', 'evidence'] },
    run: (store, a) => {
      const t = store.update('tasks', (tasks) => {
        const t = tasks.find((x) => x.id === a.taskId);
        if (!t) throw new Refused(`No task ${a.taskId}.`);
        if (t.agent !== a.agent) throw new Refused(`${a.taskId} belongs to ${t.agent}.`);
        t.status = 'reported';
        t.report = { summary: a.summary, evidence: a.evidence, notVerified: a.notVerified, date: now() };
        store.log({ agent: a.agent, event: 'report_done', id: t.id });
        return t;
      });
      // Event-driven: the report lands in the commander's inbox, so the war room never has to poll chats.
      store.update('messages', (messages) => {
        messages.push({ id: messages.length + 1, from: a.agent, to: store.config().commander, kind: 'handoff', text: `Task ${t.id} (${t.title}) reported done: ${a.summary}. Evidence: ${a.evidence}${a.notVerified ? `. Not verified by the worker: ${a.notVerified}` : ''}`, date: now(), open: true });
      });
      return { ok: true, next: 'The commander will re-check your evidence before it counts.' };
    },
  },
  {
    name: 'verify_task',
    description: 'Commander only: after re-running the done check yourself, accept or reject a reported task. Accepting marks its milestone check verified and moves the progress bar.',
    inputSchema: { type: 'object', properties: { agent: AGENT, taskId: str('Task id.'), accepted: { type: 'boolean' }, howChecked: str('What you re-ran or read yourself.') }, required: ['agent', 'taskId', 'accepted', 'howChecked'] },
    run: (store, a) => {
      needCommander(store, a.agent);
      const t = store.update('tasks', (tasks) => {
        const t = tasks.find((x) => x.id === a.taskId);
        if (!t) throw new Refused(`No task ${a.taskId}.`);
        if (t.status !== 'reported') throw new Refused(`${t.id} is "${t.status}", not reported.`);
        t.status = a.accepted ? 'verified' : 'rejected';
        t.verification = { accepted: a.accepted, howChecked: a.howChecked, date: now() };
        if (!a.accepted) t.rejectNote = a.howChecked;
        return t;
      });
      if (a.accepted && t.checkId) {
        store.update('goals', (goals) => {
          for (const g of goals) for (const m of g.milestones || []) for (const c of m.checks) {
            if (c.id === t.checkId) Object.assign(c, { verified: true, evidence: a.howChecked, verifiedAt: now() });
          }
        });
      }
      store.log({ agent: a.agent, event: a.accepted ? 'verified' : 'rejected', id: t.id });
      return t;
    },
  },
  {
    name: 'post_message',
    description: 'Send a message to another agent, the commander, or "all". kind: request, contract (an interface the other side builds against), handoff, question, conflict.',
    inputSchema: { type: 'object', properties: { agent: AGENT, to: str('Agent name, "commander" or "all".'), kind: { type: 'string', enum: ['request', 'contract', 'handoff', 'question', 'conflict', 'info'] }, text: str('What, which file/function, why.') }, required: ['agent', 'to', 'kind', 'text'] },
    run: (store, a) => store.update('messages', (messages) => {
      const to = a.to === 'commander' ? store.config().commander : a.to;
      const m = { id: messages.length + 1, from: a.agent, to, kind: a.kind, text: a.text, date: now(), open: true };
      messages.push(m);
      store.log({ agent: a.agent, event: 'message', id: m.id, to });
      return m;
    }),
  },
  {
    name: 'read_messages',
    description: 'Read open messages addressed to you (or all). Pass close=[ids] with a reply to close them.',
    inputSchema: { type: 'object', properties: { agent: AGENT, close: { type: 'array', items: { type: 'number' } }, reply: str('Reply text recorded on the closed messages.') }, required: ['agent'] },
    run: (store, a) => store.update('messages', (messages) => {
      for (const m of messages) if (a.close?.includes(m.id) && (m.to === a.agent || m.to === 'all')) Object.assign(m, { open: false, reply: a.reply, closedBy: a.agent, closed: now() });
      return messages.filter((m) => m.open && (m.to === a.agent || m.to === 'all'));
    }),
  },
];

export function callTool(store, name, args = {}) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { error: `Unknown tool ${name}` };
  if (!store.exists() && name !== 'war_room_brief') return { error: 'No war room in this project yet. Run /war-room (or: war-room init) first.' };
  try {
    const out = tool.run(store, args);
    return { text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) };
  } catch (e) {
    return { error: e instanceof Refused ? e.message : `War room error: ${e.message}` };
  }
}
