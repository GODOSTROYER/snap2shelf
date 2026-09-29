// Exact-value secret scan: fails if any value from .env.local that must stay private
// appears in a tracked/staged file or anywhere in git history. Prints variable NAMES only.
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const env = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '';
const PRIVATE = /(SECRET|CLOUDINARY_URL|ACCESS_CODE|_API_KEY$)/;
const needles = [];
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/);
  if (!m || !PRIVATE.test(m[1]) || m[2].length < 6) continue;
  if (m[1].startsWith('NEXT_PUBLIC_')) continue; // public by design
  needles.push({ name: m[1], value: m[2] });
}
// the main API key is exposed on purpose as NEXT_PUBLIC_CLOUDINARY_API_KEY for signed widget uploads
const publicKey = (env.match(/^NEXT_PUBLIC_CLOUDINARY_API_KEY=(.*)$/m) || [])[1]?.trim();
const checks = needles.filter(n => n.value !== publicKey);

const sh = cmd => execSync(cmd, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
const sources = [];
const tracked = sh('git ls-files -co --exclude-standard').split('\n').filter(Boolean);
for (const f of tracked) { try { sources.push({ where: `file ${f}`, text: readFileSync(f, 'utf8') }); } catch {} }
try { sources.push({ where: 'staged diff', text: sh('git diff --cached') }); } catch {}
try { sources.push({ where: 'git history', text: sh('git log -p --all --no-color') }); } catch {}

const generic = [/cloudinary:\/\/\d{6,}:[A-Za-z0-9_-]{10,}@/, /api_secret["'\s:=]+[A-Za-z0-9_-]{20,}/i];
let bad = 0;
for (const s of sources) {
  for (const n of checks) if (s.text.includes(n.value)) { console.error(`LEAK: value of ${n.name} found in ${s.where}`); bad++; }
  for (const re of generic) if (re.test(s.text)) { console.error(`LEAK?: credential-shaped string (${re.source.slice(0, 24)}…) in ${s.where}`); bad++; }
}
console.log(`secret-scan: ${checks.length} private values × ${sources.length} sources checked → ${bad ? bad + ' problem(s)' : 'clean'}`);
process.exit(bad ? 1 : 0);
