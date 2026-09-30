// Live check of the shelf OG image: fetch, ffprobe, save for eyeballing.
//   node --conditions=react-server --import tsx scripts/dev/og-check.mts
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { loadEnv } from "../lib/env.mjs";

loadEnv();
const { ogImageUrl } = await import("../../lib/transform/og.ts");
const heroes = ["snap2shelf/dev/heroes/sneaker-diwali", "snap2shelf/dev/heroes/bottle-kitchen", "snap2shelf/dev/heroes/pouch-jute", "snap2shelf/dev/kit/sneaker-diwali/recolor-1e3a8a"];
for (const [name, shop, n] of [["og-4", "Meera's Home Store", 4], ["og-2-hindi", "मीरा होम स्टोर", 2]] as const) {
  const b = ogImageUrl({ heroes: heroes.slice(0, n), shopName: shop });
  const res = await fetch(b.url);
  const buf = Buffer.from(await res.arrayBuffer());
  const f = `scripts/spikes/out/view/${name}.jpg`;
  if (res.ok) writeFileSync(f, buf);
  const dims = res.ok ? execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", f], { encoding: "utf8" }).trim() : "";
  console.log(name, res.status, res.headers.get("x-cld-error") ?? "", res.headers.get("content-type"), dims, buf.length);
}
