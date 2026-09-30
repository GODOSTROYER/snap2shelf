// Spike 10: how fast can the laptop notice that the phone uploaded snap2shelf/products/<sku>/raw?
// Compares, for a fresh sku (all probes primed with a 404 BEFORE the upload, like a waiting laptop):
//   a0 delivery URL, no buster          (does the CDN cache the 404?)
//   a1 delivery URL + ?cb=<n>           (query-string buster)
//   a2 delivery URL with /v<n>/         (version-component buster)
//   b0 client list JSON s2s-sku-<sku>, no buster
//   b1 client list JSON + ?cb=<n>
//   c  Admin API resource lookup (what GET /api/capture/:sku does), every 2 s
// Costs: one upload, no transformations, no AI.
//   node --conditions=react-server --import tsx scripts/spikes/10-capture-poll.mts
import { appendFileSync, mkdirSync } from "node:fs";
import { loadEnv } from "../lib/env.mjs";
import { signedRawUpload } from "../lib/signed-upload.mts";

loadEnv();
const { getResource } = await import("../../lib/server/cld.ts");
mkdirSync("scripts/spikes/out", { recursive: true });

const cloud = process.env.CLOUDINARY_CLOUD_NAME!;
const sku = Array.from({ length: 8 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
const pid = `snap2shelf/products/${sku}/raw`;
const D = `https://res.cloudinary.com/${cloud}/image/upload`;
const L = `https://res.cloudinary.com/${cloud}/image/list/s2s-sku-${sku}.json`;
let n = Date.now();
const variants: Record<string, () => string> = {
  a0: () => `${D}/${pid}`,
  a1: () => `${D}/${pid}?cb=${++n}`,
  a2: () => `${D}/v${++n}/${pid}`,
  b0: () => L,
  b1: () => `${L}?cb=${++n}`,
};

async function hit(url: string, method = "HEAD") {
  const t = Date.now();
  const r = await fetch(url, { method, headers: { Origin: "http://localhost:3000" } });
  if (method === "GET") await r.arrayBuffer();
  return {
    status: r.status,
    ms: Date.now() - t,
    cache: r.headers.get("cache-control"),
    cdn: r.headers.get("x-cache") ?? r.headers.get("cf-cache-status") ?? r.headers.get("server-timing")?.slice(0, 60) ?? null,
    age: r.headers.get("age"),
    cors: r.headers.get("access-control-allow-origin"),
  };
}

console.log(`sku ${sku}`);
// prime: the laptop is already polling before the phone uploads
for (const [k, f] of Object.entries(variants)) {
  const method = k.startsWith("b") ? "GET" : "HEAD";
  const r1 = await hit(f(), method);
  const r2 = await hit(f(), method);
  console.log(`pre ${k}: ${r1.status}/${r2.status} cache=${r1.cache} cdn=${r2.cdn} age=${r2.age} cors=${r1.cors}`);
}
const pre = await getResource(pid);
console.log(`pre c: ${pre ? "found" : "404"}`);

const up = await signedRawUpload("Z:/Projects/Cloudinary/photos/decent/06_steel_bottle.png", sku, { context: "origin=phone" });
const T0 = Date.now();
console.log(`uploaded ${up.public_id} ${up.width}x${up.height} ${up.bytes} B in ${up.ms} ms`);

const seen: Record<string, number | null> = { a0: null, a1: null, a2: null, b0: null, b1: null, c: null };
const deadline = T0 + 90_000;
let lastAdmin = 0;
let adminCalls = 0;
while (Date.now() < deadline && Object.values(seen).some((v) => v === null)) {
  await Promise.all(
    Object.entries(variants).map(async ([k, f]) => {
      if (seen[k] !== null) return;
      const r = await hit(f(), k.startsWith("b") ? "GET" : "HEAD");
      if (r.status === 200) {
        seen[k] = Date.now() - T0;
        console.log(`  ${k}: 200 after ${seen[k]} ms (cache=${r.cache} cors=${r.cors})`);
      }
    }),
  );
  if (seen.c === null && Date.now() - lastAdmin >= 2000) {
    lastAdmin = Date.now();
    adminCalls++;
    const t = Date.now();
    const r = await getResource(pid);
    if (r) {
      seen.c = Date.now() - T0;
      console.log(`  c: found after ${seen.c} ms (lookup ${Date.now() - t} ms, origin=${r.context.origin})`);
    }
  }
  await new Promise((r) => setTimeout(r, 500));
}
const rec = { spike: "10-capture", at: new Date().toISOString(), sku, upload_ms: up.ms, seen_ms: seen, admin_calls: adminCalls };
appendFileSync("scripts/spikes/out/usage-log.jsonl", JSON.stringify(rec) + "\n");
console.log(JSON.stringify(rec));
