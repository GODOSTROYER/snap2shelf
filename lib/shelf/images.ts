/**
 * Delivery URLs for shelf images. Pure and client-safe.
 * Versioned URLs (v<version>) so a re-saved hero never serves a stale CDN copy.
 */
import { deliveryBase } from "../transform/composite";
import { PLATE } from "../types";
import { productCrop } from "./og";
import type { PlateBox } from "./types";

/** Widths the storefront asks for: phone 1x/2x/3x columns up to the full 1080 plate. */
export const HERO_WIDTHS = [360, 540, 720, 900, 1080] as const;

export interface HeroImageOptions {
  version?: number;
  cloud?: string;
  /** Product box on the plate: crop a 4:5 window around it so the product reads larger (scene kept). */
  geo?: PlateBox;
}

const v = (version?: number) => (version ? `v${version}/` : "");

/** Width of the source window: the crop when there is one, else the plate. */
export function sourceWidth(geo?: PlateBox): number {
  const m = geo ? /c_crop,w_(\d+)/.exec(productCrop(geo)) : null;
  return m ? Number(m[1]) : PLATE.width;
}

export function heroUrl(publicId: string, width: number, o: HeroImageOptions = {}): string {
  const crop = o.geo ? `${productCrop(o.geo)}/` : "";
  // c_limit: never upscale past the source window
  return `${deliveryBase(o.cloud)}/${crop}c_limit,w_${width}/f_auto,q_auto/${v(o.version)}${publicId}`;
}

export function heroSrcSet(publicId: string, o: HeroImageOptions = {}): string {
  const max = sourceWidth(o.geo);
  const widths = [...HERO_WIDTHS.filter((w) => w < max), max];
  return widths.map((w) => `${heroUrl(publicId, w, o)} ${w}w`).join(", ");
}

/** ~600-byte blurred JPEG, inlined as a data URI by the server for the blur-up. */
export function lqipUrl(publicId: string, o: HeroImageOptions = {}): string {
  const crop = o.geo ? `${productCrop(o.geo)}/` : "";
  return `${deliveryBase(o.cloud)}/${crop}c_scale,w_24/e_blur:300/q_40/f_jpg/${v(o.version)}${publicId}`;
}

/** The transformation the storefront uses, for the X-ray footnote. */
export const HERO_XRAY = "c_crop (around the product)/c_limit,w_<360…1080>/f_auto,q_auto";
