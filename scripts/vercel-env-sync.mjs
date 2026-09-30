// Push .env.local to the linked Vercel project (production + preview) via stdin.
// Values are never printed or passed on the command line.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SKIP = new Set(['VERCEL_OIDC_TOKEN', 'NEXT_PUBLIC_SITE_URL']);
const only = process.argv.slice(2);
const vars = readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/)).filter(Boolean)
  .map(([, name, value]) => ({ name, value }))
  .filter((v) => !SKIP.has(v.name) && (!only.length || only.includes(v.name)));

for (const { name, value } of vars) {
  const sensitive = !name.startsWith('NEXT_PUBLIC_') && /(SECRET|_API_KEY|CLOUDINARY_URL|ACCESS_CODE)/.test(name);
  const r = spawnSync('vercel', ['env', 'add', name, 'production,preview', '--force', '--yes', sensitive ? '--sensitive' : '--no-sensitive'], {
    input: value, encoding: 'utf8', shell: process.platform === 'win32',
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').filter((l) => /added|overrid|error|✓|updated/i.test(l)).map((l) => l.trim()).slice(-1)[0] ?? '';
  console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${name}${sensitive ? ' (sensitive)' : ''} ${r.status === 0 ? '' : out.replaceAll(value, '***')}`);
}
