/**
 * Delivery URLs for shelf images. Pure and client-safe.
 * Versioned URLs (v<version>) so a re-saved hero never serves a stale CDN copy.
 */
import { deliveryBase } from "../transform/composite";

/** Widths the storefront asks for: phone 1x/2x/3x columns up to the full 1080 plate. */
export const HERO_WIDTHS = [360, 540, 720, 900, 1080] as const;

const v = (version?: number) => (version ? `v${version}/` : "");

export function heroUrl(publicId: string, width: number, version?: number, cloud?: string): string {
  return `${deliveryBase(cloud)}/c_scale,w_${width}/f_auto,q_auto/${v(version)}${publicId}`;
}

export function heroSrcSet(publicId: string, version?: number, cloud?: string): string {
  return HERO_WIDTHS.map((w) => `${heroUrl(publicId, w, version, cloud)} ${w}w`).join(", ");
}

/** ~600-byte blurred JPEG, inlined as a data URI by the server for the blur-up. */
export function lqipUrl(publicId: string, version?: number, cloud?: string): string {
  return `${deliveryBase(cloud)}/c_scale,w_24/e_blur:300/q_40/f_jpg/${v(version)}${publicId}`;
}

/** The transformation the storefront uses, for the X-ray footnote. */
export const HERO_XRAY = "c_scale,w_<360…1080>/f_auto,q_auto";
