/**
 * Getting a product photo into Cloudinary without our server touching the bytes:
 * the browser/phone uploads directly with parameters signed by /api/sign-upload.
 */
import type { SignUploadResponse } from "../api-contract";
import { cloudName, deliveryBase } from "../transform/composite";
import { productId, type Sku } from "../types";
import { sleep } from "./util";

export const UPLOAD_PRESET = "s2s_ingest";
export const rawPublicId = (sku: Sku) => productId(sku, "raw");

export interface RawInfo {
  width: number;
  height: number;
  bytes: number;
}

/**
 * Is the raw photo there yet? fl_getinfo answers with its size as JSON (404 until
 * it exists). The query string only defeats CDN caching of the 404.
 */
export async function rawInfo(sku: Sku, signal?: AbortSignal): Promise<RawInfo | null> {
  const res = await fetch(`${deliveryBase()}/fl_getinfo/${rawPublicId(sku)}?poll=${Date.now()}`, { signal, cache: "no-store" });
  if (!res.ok) return null;
  const j = (await res.json()) as { input?: RawInfo };
  return j.input ?? null;
}

/** Poll until the phone's upload lands (or the signal aborts). */
export async function waitForRaw(sku: Sku, signal: AbortSignal, everyMs = 2500): Promise<RawInfo> {
  for (;;) {
    try {
      const info = await rawInfo(sku, signal);
      if (info) return info;
    } catch (e) {
      if (signal.aborted) throw e;
    }
    await sleep(everyMs, signal);
  }
}

export class UploadError extends Error {}

/** Phones produce 4–12 MB photos; keep uploads under the 10 MB image limit and quick on mobile data. */
export async function prepareForUpload(file: File, maxBytes = 8 * 1024 * 1024, maxEdge = 3000): Promise<Blob> {
  if (file.size <= maxBytes) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    return blob ?? file;
  } catch {
    return file;
  }
}

async function sign(params: Record<string, string | number>): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/sign-upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paramsToSign: params }),
    });
  } catch {
    throw new UploadError("No connection. Check your signal and try again.");
  }
  if (res.status === 404) throw new UploadError("Uploads aren't switched on for this site yet. Try the sample product instead.");
  if (!res.ok) throw new UploadError("The upload couldn't be authorised. Try again.");
  return ((await res.json()) as SignUploadResponse).signature;
}

/** Signed direct upload to snap2shelf/products/<sku>/raw with progress. */
export async function signedUpload(file: Blob, sku: Sku, onProgress: (fraction: number) => void): Promise<RawInfo> {
  const apiKey = process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY;
  if (!apiKey || !cloudName()) throw new UploadError("Uploads aren't configured for this site yet.");
  const timestamp = Math.round(Date.now() / 1000);
  const params = { public_id: rawPublicId(sku), timestamp, upload_preset: UPLOAD_PRESET };
  const signature = await sign(params);

  const form = new FormData();
  form.append("file", file);
  form.append("api_key", apiKey);
  form.append("signature", signature);
  for (const [k, v] of Object.entries(params)) form.append(k, String(v));

  return new Promise<RawInfo>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${cloudName()}/image/upload`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new UploadError("The upload was interrupted. Check your connection and try again."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const r = JSON.parse(xhr.responseText) as RawInfo;
        resolve({ width: r.width, height: r.height, bytes: r.bytes });
      } else if (xhr.status === 400 && /file size/i.test(xhr.responseText)) {
        reject(new UploadError("That photo is too large. Try again with a smaller one."));
      } else {
        reject(new UploadError("Cloudinary didn't accept the upload. Try again."));
      }
    };
    xhr.send(form);
  });
}
