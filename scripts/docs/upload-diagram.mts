// Upload the hand-authored architecture diagram to the MAIN environment so the README
// can embed it as a Cloudinary delivery URL (rasterised on the fly):
//   https://res.cloudinary.com/<cloud>/image/upload/f_png,w_1600/snap2shelf/docs/architecture
//
//   node --import tsx scripts/docs/upload-diagram.mts [--file docs/architecture.svg]
//
// Credentials come from .env.local via scripts/lib/env.mjs and are passed per call;
// nothing secret is printed. Re-running overwrites the asset and invalidates the CDN,
// so the unversioned README URL picks up the new version.
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { v2 as cloudinary } from "cloudinary";
import { loadEnv } from "../lib/env.mjs";

loadEnv();
const { values } = parseArgs({ options: { file: { type: "string", default: "docs/architecture.svg" } } });
const file = values.file!;
if (!existsSync(file)) throw new Error(`${file} not found (run from the repo root)`);

const { CLOUDINARY_CLOUD_NAME: cloud_name, CLOUDINARY_API_KEY: api_key, CLOUDINARY_API_SECRET: api_secret } = process.env;
if (!cloud_name || !api_key || !api_secret) {
  console.error("Main Cloudinary account is not configured (CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET).");
  process.exit(1);
}

const PUBLIC_ID = "snap2shelf/docs/architecture";
const res = await cloudinary.uploader.upload(file, {
  cloud_name,
  api_key,
  api_secret,
  public_id: PUBLIC_ID,
  resource_type: "image",
  overwrite: true,
  invalidate: true,
  unique_filename: false,
  tags: ["s2s", "s2s-docs"],
});

const url = `https://res.cloudinary.com/${cloud_name}/image/upload/f_png,w_1600/${PUBLIC_ID}`;
console.log(JSON.stringify({ public_id: res.public_id, version: res.version, format: res.format, width: res.width, height: res.height, bytes: res.bytes }));
console.log(`README url: ${url}`);
console.log(`versioned:  https://res.cloudinary.com/${cloud_name}/image/upload/f_png,w_1600/v${res.version}/${PUBLIC_ID}`);
