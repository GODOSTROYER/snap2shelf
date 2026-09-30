/**
 * Shelf + Collection contracts (client-safe). Re-exported from lib/api-contract.ts.
 *
 * Storage model (Cloudinary only, no database):
 *   a shelf is a TAG on product heroes:  s2s-shop-<shop>
 *   shelf facts live in each hero's context:
 *     st_<key>  shop title          so_<key>  position on the shelf     sl_<key>  tagline
 *     name / caption / sku          product facts copied from the raw asset at publish time
 *     geo                           "px,py,pw,ph" product box on the 1080x1350 plate (collection mode)
 *   <key> is the shop slug with "-" → "_" (context keys stay plain identifiers).
 */
import type { KitAsset, SceneDNA, Sku } from "../types";

/** Product box on the canonical 1080x1350 plate (see lib/transform/composite.ts geometry()). */
export interface PlateBox {
  px: number;
  py: number;
  pw: number;
  ph: number;
}

export interface ShelfItem {
  sku: Sku;
  heroPublicId: string;
  version: number;
  width: number;
  height: number;
  name: string;
  caption: string;
  order: number;
  geo?: PlateBox;
}

export interface Shelf {
  shop: string;
  title: string;
  tagline?: string;
  items: ShelfItem[];
}

// POST /api/shelf  { shop, title, tagline?, skus[] }  → tags each product's current hero with s2s-shop-<shop>
export interface ShelfRequest {
  shop: string; // ^[a-z0-9-]{3,32}$
  title: string; // 1..60 chars
  tagline?: string; // 0..90 chars
  skus: Sku[]; // 1..12, shelf order
}
export interface ShelfResponse {
  shop: string;
  url: string; // "/shelf/<shop>"
  ogImage: string; // 1200x630 Cloudinary collage URL
  items: { sku: Sku; heroPublicId: string }[];
  skipped: { sku: Sku; reason: string }[]; // e.g. no hero saved yet
  removed: string[]; // hero public_ids that left the shelf
}

// GET /api/shelf/:shop  → the shelf as the storefront renders it
export type ShelfGetResponse = Shelf;

// POST /api/collection  { skus[2..6], scenePublicId }  → every product staged on the SAME scene
export interface CollectionRequest {
  skus: Sku[];
  scenePublicId: string; // snap2shelf/scenes/<theme>/<slug>
}
export interface CollectionItem {
  sku: Sku;
  name: string;
  hero: KitAsset; // publicId = saved hero; xray = the composite URL it was saved from
  geo: PlateBox;
}
export interface CollectionResponse {
  scene: { publicId: string; title: string; theme: string; dna: SceneDNA };
  /** The shared recipe that makes the set consistent (same light, same shadow, same visual weight). */
  consistency: { lightAzimuth: number; lightElevation: number; baselineY: number; targetArea: number };
  items: CollectionItem[];
  failed: { sku: Sku; error: string }[];
  ms: number;
}
