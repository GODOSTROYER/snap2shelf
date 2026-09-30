import { customAlphabet } from "nanoid";

/** 8 lower-case alphanumerics, matching SKU_RE in lib/types.ts. (Own module: the landing's phone button needs it without util's tailwind-merge.) */
export const newSku = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);
