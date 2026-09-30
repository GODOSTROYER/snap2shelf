/**
 * Kit Reel: a short vertical video made purely from delivery URLs
 * (e_zoompan turns a still into video, fl_splice joins shots). Recipe from
 * SPIKES.md §6, verified live: 3 shots → 9 s H.264 at 640×1138, no generation credits.
 * Pure and client-safe.
 */
import { deliveryBase, layerId } from "../transform/composite";
import { encodeOverlayText } from "../transform/channels";
import type { BuiltUrl, Placement, XraySegment } from "../types";

export interface ReelInput {
  heroPublicId: string; // saved, non-transparent hero
  extraShotPublicIds?: string[]; // other saved stills, e.g. an approved creative take
  closeUp?: { scenePublicId: string; cutoutPublicId: string; placement: Placement };
  caption?: string; // held across every shot (Devanagari works)
  cloud?: string;
}

const SHOT = 3; // seconds per shot
const ZOOM = `e_zoompan:du_${SHOT};maxzoom_1.2;fps_25`;
const FRAME = "c_fill,w_720,h_1280";

export function reelUrl(i: ReelInput): { url: string; xray: BuiltUrl; seconds: number } {
  const segs: XraySegment[] = [];
  const push = (text: string, kind: XraySegment["kind"], label: string) => segs.push({ text, kind, label });

  push(FRAME, "crop", "Vertical 9:16 frame");
  push(ZOOM, "video", `A slow zoom turns the hero photo into ${SHOT} s of video`);
  let shots = 1;

  for (const id of i.extraShotPublicIds ?? []) {
    push(
      `fl_splice:transition_(name_fade;du_0.6),l_${layerId(id)}/${FRAME}/${ZOOM}/fl_layer_apply`,
      "video",
      "Splices the next shot on with a fade",
    );
    shots++;
  }

  if (i.closeUp) {
    const g = i.closeUp.placement === "flatlay" ? "g_center" : "g_south,y_260";
    push(
      `fl_splice:transition_(name_fade;du_0.6),l_${layerId(i.closeUp.scenePublicId)}/${FRAME}/l_${layerId(i.closeUp.cutoutPublicId)}/c_scale,w_560/fl_layer_apply,${g}/${ZOOM}/fl_layer_apply`,
      "video",
      "A close-up shot: your cut-out, larger, on the same scene",
    );
    shots++;
  }

  if (i.caption?.trim()) {
    push(
      `l_text:Noto%20Sans%20Devanagari@google_64_700:${encodeOverlayText(i.caption.trim())},co_white/fl_layer_apply,g_north,y_170`,
      "text",
      "Caption held across every shot (Google font, no upload)",
    );
  }

  push("q_auto", "format", "Automatic quality for the viewer's connection");
  const transformation = segs.map((s) => s.text).join("/");
  segs.push({ text: `${i.heroPublicId}.mp4`, kind: "asset", label: "The saved hero, delivered as MP4" });
  return {
    url: `${deliveryBase(i.cloud)}/${transformation}/${i.heroPublicId}.mp4`,
    xray: { url: `${deliveryBase(i.cloud)}/${transformation}/${i.heroPublicId}.mp4`, transformation, segments: segs },
    seconds: shots * SHOT,
  };
}

/** Poster frame for the reel: the hero, cropped the same way. */
export function reelPoster(heroPublicId: string, cloud?: string) {
  return `${deliveryBase(cloud)}/${FRAME}/c_scale,w_360/f_auto,q_auto/${heroPublicId}`;
}
