import "server-only";
import { v2 as cloudinary, type UploadApiOptions, type UploadApiResponse } from "cloudinary";
import { getMainAccount, type CloudinaryAccount } from "./accounts";
import { cldSafe } from "./safe";

/**
 * Make sure an asset produced on any pool account ends up in `main`, where
 * layers, search and delivery happen. Results made on main are returned as-is.
 */
export async function copyToMain(
  from: CloudinaryAccount,
  asset: { secure_url: string; public_id?: string; asset_id?: string },
  options: Omit<UploadApiOptions, "api_key" | "api_secret" | "cloud_name"> & { public_id: string },
): Promise<{ public_id: string; secure_url: string; asset_id: string; width?: number; height?: number; copied: boolean }> {
  const main = getMainAccount();
  if (from.isMain && asset.public_id && asset.asset_id) {
    return { public_id: asset.public_id, secure_url: asset.secure_url, asset_id: asset.asset_id, copied: false };
  }
  const res: UploadApiResponse = await cldSafe("copy-upload", () =>
    cloudinary.uploader.upload(asset.secure_url, {
      overwrite: false,
      unique_filename: false,
      resource_type: "image",
      ...options,
      cloud_name: main.cloudName,
      api_key: main.apiKey,
      api_secret: main.apiSecret,
    }),
  );
  return {
    public_id: res.public_id,
    secure_url: res.secure_url,
    asset_id: res.asset_id,
    width: res.width,
    height: res.height,
    copied: true,
  };
}
