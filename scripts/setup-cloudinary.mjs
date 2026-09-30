// One-time (idempotent) Cloudinary setup for the MAIN product environment.
//   npm run setup:cloudinary
//
// 1. Signed upload preset `s2s_ingest` used by the laptop widget and the phone capture page.
// 2. Named transformations from lib/transform/named.ts, if that file exists
//    (owned by the transformations workstream). Created, or updated with unsafe_update.
//
// Never prints credentials. Pool accounts are not touched.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { v2 as cloudinary } from 'cloudinary';
import { loadEnv } from './lib/env.mjs';

loadEnv();
const { CLOUDINARY_CLOUD_NAME: cloud_name, CLOUDINARY_API_KEY: api_key, CLOUDINARY_API_SECRET: api_secret } = process.env;
if (!cloud_name || !api_key || !api_secret) {
  console.error('Main Cloudinary account is not configured (CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET).');
  process.exit(1);
}
const auth = { cloud_name, api_key, api_secret };

/** Cloudinary SDK rejections are plain objects: { error: { message, http_code } }. */
const httpCode = (err) => err?.error?.http_code ?? err?.http_code;
const message = (err) => err?.error?.message ?? err?.message ?? String(err);

// ---------------------------------------------------------------- upload preset
export const INGEST_PRESET = 's2s_ingest';
const presetSettings = {
  unsigned: false,
  overwrite: false,
  unique_filename: false,
  use_filename: false,
  tags: 's2s,s2s-raw',
  // incoming transformation c_limit,w_2400,h_2400: never store more than 2400 px on the long side.
  // (The SDK reads a plain string here as a named transformation, so pass the object form.)
  transformation: [{ crop: 'limit', width: 2400, height: 2400 }],
  allowed_formats: 'jpg,jpeg,png,webp,heic',
};

async function ensurePreset() {
  let exists = false;
  try {
    await cloudinary.api.upload_preset(INGEST_PRESET, auth);
    exists = true;
  } catch (err) {
    if (httpCode(err) !== 404) throw new Error(`reading upload preset failed: ${message(err)}`);
  }
  if (exists) {
    await cloudinary.api.update_upload_preset(INGEST_PRESET, { ...presetSettings, ...auth });
    console.log(`upload preset ${INGEST_PRESET}: updated`);
  } else {
    await cloudinary.api.create_upload_preset({ name: INGEST_PRESET, ...presetSettings, ...auth });
    console.log(`upload preset ${INGEST_PRESET}: created`);
  }
  const p = await cloudinary.api.upload_preset(INGEST_PRESET, auth);
  const s = p.settings ?? {};
  console.log(`  unsigned=${p.unsigned} overwrite=${s.overwrite} unique_filename=${s.unique_filename} tags=${s.tags} allowed_formats=${s.allowed_formats} transformation=${JSON.stringify(s.transformation)}`);
}

// ---------------------------------------------------------------- named transformations
/**
 * Accepts either shape from lib/transform/named.ts:
 *   export const NAMED_TRANSFORMATIONS = { s2s_hero: "c_fill,w_1080,h_1350/f_auto,q_auto", ... }
 *   export const NAMED_TRANSFORMATIONS = [{ name: "s2s_hero", transformation: "..." }, ...]
 * Names are without the "t_" prefix.
 */
function normaliseNamed(named) {
  if (!named) return [];
  if (Array.isArray(named)) {
    return named.map((n) => ({ name: n.name, definition: n.transformation ?? n.definition }));
  }
  return Object.entries(named).map(([name, v]) => ({
    name,
    definition: typeof v === 'string' ? v : (v?.transformation ?? v?.definition),
  }));
}

async function ensureNamedTransformations() {
  const file = resolve(process.cwd(), 'lib/transform/named.ts');
  if (!existsSync(file)) {
    console.log('named transformations: lib/transform/named.ts not present yet, skipped');
    return;
  }
  const { tsImport } = await import('tsx/esm/api');
  const mod = await tsImport(pathToFileURL(file).href, import.meta.url);
  const list = normaliseNamed(mod.NAMED_TRANSFORMATIONS ?? mod.default?.NAMED_TRANSFORMATIONS);
  if (!list.length) {
    console.log('named transformations: NAMED_TRANSFORMATIONS is empty, nothing to do');
    return;
  }
  for (const { name, definition } of list) {
    const clean = String(name).replace(/^t_/, '');
    if (!/^[a-zA-Z0-9_-]+$/.test(clean) || typeof definition !== 'string' || !definition) {
      console.warn(`  skipped invalid named transformation entry "${name}"`);
      continue;
    }
    let exists = false;
    try {
      await cloudinary.api.transformation(clean, auth);
      exists = true;
    } catch (err) {
      if (httpCode(err) !== 404) throw new Error(`reading t_${clean} failed: ${message(err)}`);
    }
    if (exists) {
      await cloudinary.api.update_transformation(clean, { unsafe_update: definition }, auth);
      console.log(`  t_${clean}: updated`);
    } else {
      await cloudinary.api.create_transformation(clean, definition, auth);
      console.log(`  t_${clean}: created`);
    }
  }
}

try {
  await ensurePreset();
  await ensureNamedTransformations();
  console.log('setup-cloudinary: done');
} catch (err) {
  console.error('setup-cloudinary failed:', message(err));
  process.exit(1);
}
