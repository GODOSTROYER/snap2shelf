import { Deck } from "@/components/present/Deck";
import { PRESENT } from "@/lib/present/data";

type Search = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PresentPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const c = Number(one(sp.c));
  return (
    <Deck
      data={PRESENT}
      initial={{
        chapter: Number.isFinite(c) && c >= 1 ? c - 1 : 0,
        auto: one(sp.auto) === "1",
        clean: one(sp.clean) === "1",
      }}
    />
  );
}
