// Spike 0: read Admin API usage for every configured account (free, read-only).
import { writeFileSync } from 'node:fs';
import { loadEnv, accounts, basicAuth } from '../lib/env.mjs';
loadEnv();
const out = {};
for (const a of accounts()) {
  const r = await fetch(`https://api.cloudinary.com/v1_1/${a.cloud}/usage`, { headers: { Authorization: basicAuth(a) } });
  const j = await r.json();
  out[a.label] = { cloud: a.cloud, http: r.status, ...j };
}
writeFileSync('scripts/spikes/out/00-usage.json', JSON.stringify(out, null, 2));
for (const [label, u] of Object.entries(out)) {
  console.log(`\n== ${label} (${u.cloud}) HTTP ${u.http}`);
  if (u.error) { console.log('  error:', u.error.message); continue; }
  console.log('  plan:', u.plan, '| last_updated:', u.last_updated);
  console.log('  top-level keys:', Object.keys(u).join(', '));
  if (u.credits) console.log('  credits:', JSON.stringify(u.credits));
  for (const k of ['transformations','storage','bandwidth','requests','resources','derived_resources','media_limits']) if (u[k] !== undefined) console.log(`  ${k}:`, JSON.stringify(u[k]));
  const extra = Object.keys(u).filter(k => !['cloud','http','plan','last_updated','credits','transformations','storage','bandwidth','requests','resources','derived_resources','media_limits','objects','rate_limit_allowed','rate_limit_reset_at','rate_limit_remaining'].includes(k));
  for (const k of extra) console.log(`  ${k}:`, JSON.stringify(u[k]));
}
