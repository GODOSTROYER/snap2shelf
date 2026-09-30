import type { ComponentType } from "react";
import type { ChapterId } from "@/lib/present/chapters";
import type { ChapterProps } from "./common";
import { Closing, Shelf } from "./finale";
import { ColdOpen, Cutout, Pipeline } from "./opening";
import { ChannelPack, QaGate, Reel } from "./proof";
import { SceneDnaChapter, Stages } from "./staging";
import { Cost, Xray } from "./url";

export const CHAPTER_VIEWS: Record<ChapterId, ComponentType<ChapterProps>> = {
  "cold-open": ColdOpen,
  pipeline: Pipeline,
  cutout: Cutout,
  dna: SceneDnaChapter,
  stages: Stages,
  qa: QaGate,
  pack: ChannelPack,
  reel: Reel,
  xray: Xray,
  cost: Cost,
  shelf: Shelf,
  closing: Closing,
};
