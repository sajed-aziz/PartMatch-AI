// Shared by the form and route handlers; keep this module browser-safe.
export const maximumPhotoSize = 10 * 1024 * 1024;
export const photoInputAccept = "image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,.jpg,.jpeg,.png,.webp,.heic,.heif,.avif";

const aiPhotoTypes = ["image/jpeg", "image/png", "image/webp"] as const;
const requestPhotoTypes = [...aiPhotoTypes, "image/heic", "image/heif", "image/avif"] as const;
const photoTypesByExtension: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif", ".avif": "image/avif",
};

type PhotoMetadata = Pick<File, "name" | "type" | "size">;
type PhotoPurpose = "request" | "analysis";

export function getPhotoMimeType(photo: PhotoMetadata, purpose: PhotoPurpose = "request"): string | null {
  const types: readonly string[] = purpose === "analysis" ? aiPhotoTypes : requestPhotoTypes;
  if (types.includes(photo.type)) return photo.type;
  // Some devices omit MIME metadata. A filename fallback is only for seller
  // review; it must never override an explicitly unsupported MIME type.
  if (purpose === "request" && (!photo.type || photo.type === "application/octet-stream")) {
    const extension = photo.name.slice(photo.name.lastIndexOf(".")).toLowerCase();
    return photoTypesByExtension[extension] ?? null;
  }
  return null;
}

export function validatePhotoMetadata(photo: PhotoMetadata, purpose: PhotoPurpose = "request") {
  if (photo.size === 0) return { error: "Choose a non-empty headlight photo.", status: 400 } as const;
  if (photo.size > maximumPhotoSize) return { error: "Choose a photo of 10 MB or smaller.", status: 413 } as const;
  if (!getPhotoMimeType(photo, purpose)) return {
    error: purpose === "analysis"
      ? "AI analysis supports JPG, PNG and WebP. You can still submit other supported image formats for seller review."
      : "Choose a JPG, PNG, WebP, HEIC, HEIF, or AVIF image.",
    status: 415,
  } as const;
  return null;
}
