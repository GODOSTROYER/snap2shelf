import "server-only";

/**
 * Cloudinary product environments configured for this deployment.
 *
 * `main` is where every asset is stored, composited, searched and delivered.
 * Extra `CLOUDINARY_POOL_<n>_*` environments only lend their add-on quota
 * (image generation, AI Vision); results are always copied back into `main`.
 * None of this is ever sent to the client.
 */
export interface CloudinaryAccount {
  label: string;
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  isMain: boolean;
}

let cached: CloudinaryAccount[] | null = null;

export function getAccounts(env: NodeJS.ProcessEnv = process.env): CloudinaryAccount[] {
  if (cached && env === process.env) return cached;

  const list: CloudinaryAccount[] = [];
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = env;
  if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
    list.push({
      label: "main",
      cloudName: CLOUDINARY_CLOUD_NAME,
      apiKey: CLOUDINARY_API_KEY,
      apiSecret: CLOUDINARY_API_SECRET,
      isMain: true,
    });
  }

  const poolNumbers = Object.keys(env)
    .map((k) => /^CLOUDINARY_POOL_(\d+)_CLOUD_NAME$/.exec(k)?.[1])
    .filter((n): n is string => Boolean(n))
    .map(Number)
    .sort((a, b) => a - b);

  for (const n of poolNumbers) {
    const cloudName = env[`CLOUDINARY_POOL_${n}_CLOUD_NAME`];
    const apiKey = env[`CLOUDINARY_POOL_${n}_API_KEY`];
    const apiSecret = env[`CLOUDINARY_POOL_${n}_API_SECRET`];
    if (cloudName && apiKey && apiSecret) {
      list.push({ label: `pool${n}`, cloudName, apiKey, apiSecret, isMain: false });
    }
  }

  if (env === process.env) cached = list;
  return list;
}

export function getMainAccount(): CloudinaryAccount {
  const main = getAccounts().find((a) => a.isMain);
  if (!main) throw new Error("Cloudinary main account is not configured (CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET).");
  return main;
}

export function basicAuth(account: CloudinaryAccount): string {
  return "Basic " + Buffer.from(`${account.apiKey}:${account.apiSecret}`).toString("base64");
}
