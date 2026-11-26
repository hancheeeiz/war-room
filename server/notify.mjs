// The founder's own notifier (e.g. a push script): "notifyCommand" in ~/.config/war-room/config.json, never in a
// project, so a downloaded project cannot make the war room run its commands. It gets the message as one argument.
import { execFile } from 'node:child_process';
import { now, userConfig } from './store.mjs';
import { shellSpec } from './agents.mjs';

export function notify(store, message) {
  console.error(`${now()} ${message}`);
  const cmd = userConfig().notifyCommand;
  if (!cmd) return;
  if (process.platform === 'win32') {
    const sh = shellSpec(`${cmd} "${String(message).replace(/["%\r\n]/g, ' ')}"`);
    execFile(sh.bin, sh.args, sh.opts, () => {});
  } else execFile('/bin/sh', ['-c', `${cmd} "$1"`, 'warroom-notify', message], () => {});
}
