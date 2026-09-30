// One-off library hygiene (1 Oct 2026): snap2shelf/scenes/cafe/draft-d9727c98 is a Christmas
// backdrop (rustic pine table, pine branches, red and gold baubles). It sits under theme "cafe"
// because lib/festivals.ts maps Christmas briefs to the café theme, but its title ("A rustic
// pine-wood tabletop") hid that, so plain café briefs could be offered a Christmas plate.
//
// Keeps theme "cafe" (its folder, tags and the Christmas → café mapping all agree) and only:
//   title "Winter festive café"   what the plate actually shows
//   fest  "christmas"             lib/server/scenes.ts rankScenes() offers it only to Christmas briefs
// Upload API add_context only: no Admin API call, no transformation, no AI.
//
//   node --conditions=react-server --import tsx scripts/dev/fix-scene-context.mts [--dry-run]
import { parseArgs } from "node:util";
import { loadEnv } from "../lib/env.mjs";

loadEnv();
const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });

const { addContext, mainCloud } = await import("../../lib/server/cld.ts");
const { FESTIVAL_ONLY_SCENES } = await import("../../lib/server/scenes.ts");

const ID = "snap2shelf/scenes/cafe/draft-d9727c98";
const PATCH = { title: "Winter festive café", fest: FESTIVAL_ONLY_SCENES[ID] ?? "christmas" };

type ListResource = { public_id: string; context?: { custom?: Record<string, string> } };
async function listed(): Promise<Record<string, string> | null> {
  const res = await fetch(`https://res.cloudinary.com/${mainCloud()}/image/list/s2s-scene.json`, { cache: "no-store" });
  if (!res.ok) return null;
  const j = (await res.json()) as { resources?: ListResource[] };
  return j.resources?.find((r) => r.public_id === ID)?.context?.custom ?? null;
}

const before = await listed();
if (!before) throw new Error(`${ID} is not in the scene library list`);
console.log(`before: theme=${before.theme} title="${before.title}" fest=${before.fest ?? "-"}`);
if (before.theme !== "cafe") throw new Error("unexpected theme; not touching it");
if (values["dry-run"]) {
  console.log(`dry run: would add_context ${JSON.stringify(PATCH)}`);
} else {
  await addContext([ID], PATCH);
  console.log(`add_context ${JSON.stringify(PATCH)} → ok (the CDN list shows it within ~60 s)`);
}
