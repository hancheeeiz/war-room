// Rules every war room starts with, so a new user does not have to write them first.
// They live in the plugin's code, not in a project, so a downloaded project cannot change them.
// The user can switch one off for their own computer: war-room rules --off s3 --yes.
import { userConfig } from './store.mjs';

export const STARTER_RULES = [
  { id: 's1', kind: 'rule', text: "Money: anything that spends, charges, sets a price, refunds or moves money needs the founder's yes for that exact action." },
  { id: 's2', kind: 'rule', text: "Anything that is hard to undo or reaches other people needs the founder's yes at that step: deploying or releasing, git push, uploading or submitting to a store, publishing or posting anything public, sending messages on the founder's behalf, deleting data, and using or changing passwords or keys. One yes covers only the action it was given for." },
  { id: 's3', kind: 'rule', text: 'Check before you report: re-run the command, read the file or test it yourself before you tell the founder a result or mark a check verified. If you could not check it, say "not checked".' },
  { id: 's4', kind: 'rule', text: "Keep the founder's memory: whenever the founder states a preference, a decision, a key fact, a new idea or something that needs doing, store it straight away with remember (pref, decision, fact, idea or todo), in one plain sentence with who said it. Before you ask the founder anything, recall the memory; never ask what it already answers, apply the answer." },
  { id: 's5', kind: 'rule', text: 'Ask the founder in plain words: one decision per question, with a suggested answer. Do not post an explanation or a status note as a question.' },
  { id: 's6', kind: 'rule', text: 'Take dates and times from the system clock, never from memory or from a note.' },
  { id: 's7', kind: 'rule', text: 'Work only on your task and its files. If you need a change somewhere else, post a message to its owner instead of doing it yourself.' },
  { id: 's8', kind: 'never', text: 'Do not ask a question with several parts and read a bare "yes" as covering all of them.' },
  { id: 's9', kind: 'never', text: 'Do not store passwords, keys or card numbers anywhere in the war room.' },
];

export function starterRules({ includeOff = false } = {}) {
  const off = new Set(userConfig().startersOff || []);
  return STARTER_RULES.map((r) => ({ ...r, off: off.has(r.id) })).filter((r) => includeOff || !r.off);
}
