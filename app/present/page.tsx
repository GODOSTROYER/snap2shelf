import { preload } from "react-dom";
import { Deck } from "@/components/present/Deck";
import { PRESENT } from "@/lib/present/data";

type Search = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PresentPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const c = Number(one(sp.c));
  const chapter = Number.isFinite(c) && c >= 1 ? c - 1 : 0;
  // the cold open's photo is fetched with the HTML, so its chapter can start the moment it hydrates
  if (chapter === 0) preload(PRESENT.product.raw.url, { as: "image", fetchPriority: "high" });
  return (
    <Deck
      data={PRESENT}
      initial={{
        chapter,
        auto: one(sp.auto) === "1",
        clean: one(sp.clean) === "1",
      }}
    />
  );
}
