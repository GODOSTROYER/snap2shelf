import { OutroCard } from "@/components/present/video/Cards";

export default async function OutroVideoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return <OutroCard hold={sp.hold === "1"} />;
}
