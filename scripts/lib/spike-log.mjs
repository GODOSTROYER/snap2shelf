// Read results recorded by earlier spikes (scripts/spikes/out/usage-log.jsonl, git-ignored).
import { readFileSync, existsSync } from 'node:fs';
const LOG = 'scripts/spikes/out/usage-log.jsonl';
export function spikeRows() {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
/** URL of the most recent spike row matching `pred`; throws if the spike has not been run yet. */
export function lastUrl(pred, what) {
  const row = spikeRows().filter((r) => r.url && pred(r)).pop();
  if (!row) throw new Error(`No recorded result for ${what}; run that spike first.`);
  return row.url;
}
