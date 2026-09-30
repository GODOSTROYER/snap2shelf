import { TitleCard } from "@/components/present/video/Cards";

export default async function TitleVideoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return <TitleCard hold={sp.hold === "1"} />;
}
