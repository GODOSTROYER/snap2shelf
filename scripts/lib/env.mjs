// Minimal .env.local loader for standalone scripts (Next.js loads it on its own at runtime).
// Never logs values.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnv(file = '.env.local') {
  const p = resolve(process.cwd(), file);
  if (!existsSync(p)) throw new Error(`${file} not found in ${process.cwd()}`);
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

/** All configured accounts: main first, then CLOUDINARY_POOL_n_* in numeric order. */
export function accounts() {
  const list = [];
  const e = process.env;
  if (e.CLOUDINARY_CLOUD_NAME && e.CLOUDINARY_API_KEY && e.CLOUDINARY_API_SECRET) {
    list.push({ label: 'main', cloud: e.CLOUDINARY_CLOUD_NAME, key: e.CLOUDINARY_API_KEY, secret: e.CLOUDINARY_API_SECRET });
  }
  const ns = Object.keys(e).map(k => k.match(/^CLOUDINARY_POOL_(\d+)_CLOUD_NAME$/)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
  for (const n of ns) {
    const cloud = e[`CLOUDINARY_POOL_${n}_CLOUD_NAME`], key = e[`CLOUDINARY_POOL_${n}_API_KEY`], secret = e[`CLOUDINARY_POOL_${n}_API_SECRET`];
    if (cloud && key && secret) list.push({ label: `pool${n}`, cloud, key, secret });
  }
  return list;
}

export const basicAuth = a => 'Basic ' + Buffer.from(`${a.key}:${a.secret}`).toString('base64');
