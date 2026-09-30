// Live check of the Kit Reel: build reelUrl(), fetch the MP4 (retrying 423 while
// it renders), ffprobe it, grab frames across the timeline and tile them.
//
//   node --conditions=react-server --import tsx scripts/dev/reel-check.mts [clipSeconds] [fadeSeconds]
//
// Output: scripts/spikes/out/view/reel.mp4, reel-frames.jpg (git-ignored).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadEnv } from "../lib/env.mjs";

loadEnv();
const { reelUrl } = await import("../../lib/transform/reel.ts");
const VIEW = "scripts/spikes/out/view";
mkdirSync(`${VIEW}/reel`, { recursive: true });

const reel = reelUrl({
  images: [
    "snap2shelf/dev/kit/sneaker-diwali/story",
    "snap2shelf/dev/heroes/sneaker-diwali",
    "snap2shelf/dev/kit/sneaker-diwali/recolor-1e3a8a",
    "snap2shelf/dev/heroes/pouch-jute",
  ],
  offer: { hindi: "दिवाली सेल · 20% छूट", english: "Diwali sale, 20% off / this week only" },
  clipSeconds: process.argv[2] ? Number(process.argv[2]) : undefined,
  fadeSeconds: process.argv[3] ? Number(process.argv[3]) : undefined,
});
console.log("url length", reel.url.length, "expected seconds", reel.seconds);

const t0 = Date.now();
let res: Response | null = null;
for (let i = 0; i < 60; i++) {
  res = await fetch(reel.url);
  if (res.status !== 423 && res.status !== 420) break;
  await res.arrayBuffer();
  await new Promise((r) => setTimeout(r, 3000));
}
const buf = Buffer.from(await res!.arrayBuffer());
console.log("HTTP", res!.status, res!.headers.get("x-cld-error") ?? "", res!.headers.get("content-type"), buf.length, "bytes", Date.now() - t0, "ms");
if (!res!.ok) process.exit(1);
writeFileSync(`${VIEW}/reel.mp4`, buf);
const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height,r_frame_rate,nb_frames", "-of", "json", `${VIEW}/reel.mp4`], { encoding: "utf8" });
console.log(probe);
const dur = Number(JSON.parse(probe).format.duration);
const times = Array.from({ length: 8 }, (_, k) => Math.max(0.05, (dur * (k + 0.5)) / 8));
const frames = times.map((t, k) => {
  const f = `${VIEW}/reel/f${k}.jpg`;
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", t.toFixed(2), "-i", `${VIEW}/reel.mp4`, "-frames:v", "1", "-vf", "scale=270:-2", f]);
  return f;
});
const filter = frames.map((_, k) => `[${k}]`).join("") + `hstack=inputs=${frames.length}`;
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...frames.flatMap((f) => ["-i", f]), "-filter_complex", filter, "-frames:v", "1", "-update", "1", `${VIEW}/reel-frames.jpg`]);
console.log("frames at", times.map((t) => t.toFixed(1)).join(", "), "→", `${VIEW}/reel-frames.jpg`);
