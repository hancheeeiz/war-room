#!/usr/bin/env node
// The safety hook's entry point. It loads the rest inside try, so broken or half-updated plugin files block the
// action instead of letting it through.
import fs from 'node:fs';

try {
  const raw = fs.readFileSync(0, 'utf8');
  const [{ runGuardSafely }, { Store }, { notify }] = await Promise.all([import('../server/guard.mjs'), import('../server/store.mjs'), import('../server/notify.mjs')]);
  process.exitCode = await runGuardSafely(raw, { store: new Store(), notify });
} catch (e) {
  process.stderr.write(`War room guard failed to start, so this action is blocked: ${e.message}. Tell the founder.\n`);
  process.exitCode = 2;
}
