import { aiVehicleModel, getHeadlightAnalyzer } from "@/lib/ai-analysis";
import { requireCustomer } from "@/lib/customer-access";
import { privateJson } from "@/lib/http";
import { AIProviderError } from "@/lib/ollama-headlight-analyzer";
import { maximumPhotoSize, validatePhotoMetadata } from "@/lib/photo-validation";

export const runtime = "nodejs";

const maximumRequestSize = maximumPhotoSize + 1024 * 1024;
const unavailableMessage = "AI analysis is unavailable. You can still submit your request for seller review.";

class UploadTooLargeError extends Error {}

// Bound the actual stream as well as Content-Length, including chunked uploads.
async function readFormData(request: Request) {
  if (!request.body) throw new Error("Missing request body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumRequestSize) {
        await reader.cancel().catch(() => {});
        throw new UploadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(bytes.buffer, {
    headers: { "Content-Type": request.headers.get("content-type") ?? "" },
  }).formData();
}

function photoMimeType(data: Uint8Array) {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (pngSignature.every((byte, index) => data[index] === byte)) return "image/png";
  if (data.length >= 12 &&
      String.fromCharCode(...data.subarray(0, 4)) === "RIFF" &&
      String.fromCharCode(...data.subarray(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export async function POST(request: Request) {
  // Browser photo uploads must identify their origin. The customer gate below
  // verifies the exact origin and rejects cross-site fetch metadata.
  if (!request.headers.get("origin")) {
    return privateJson({ error: "Use the PartMatch website." }, 403);
  }
  const access = await requireCustomer(request);
  if (access.response) return access.response;

  if (Number(request.headers.get("content-length")) > maximumRequestSize) {
    return privateJson({ error: "The uploaded request is too large." }, 413);
  }
  if (!/^multipart\/form-data(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return privateJson({ error: "Send the photo as multipart form data." }, 415);
  }

  let form: FormData;
  try {
    form = await readFormData(request);
  } catch (error) {
    return privateJson({ error: error instanceof UploadTooLargeError
      ? "The uploaded request is too large." : "The photo upload could not be read." },
    error instanceof UploadTooLargeError ? 413 : 400);
  }

  for (const field of ["model", "year", "photo", "aiConsent"]) {
    if (form.getAll(field).length !== 1) {
      return privateJson({ error: `Provide exactly one ${field} field.` }, 400);
    }
  }
  if (form.get("aiConsent") !== "true") {
    return privateJson({ error: "Confirm permission to process this photo with local AI." }, 400);
  }
  if (form.get("model") !== aiVehicleModel) {
    return privateJson({ error: "AI analysis supports Mercedes-Benz C-Class (W204) headlights only." }, 400);
  }
  const yearValue = form.get("year");
  const year = typeof yearValue === "string" && /^\d{4}$/.test(yearValue) ? Number(yearValue) : NaN;
  if (year < 2007 || year > 2014 || !Number.isInteger(year)) {
    return privateJson({ error: "Select a W204 vehicle year from 2007 to 2014." }, 400);
  }
  const photo = form.get("photo");
  if (!(photo instanceof File) || photo.size === 0) {
    return privateJson({ error: "Attach a headlight photo." }, 400);
  }
  const photoError = validatePhotoMetadata(photo, "analysis");
  if (photoError) return privateJson({ error: photoError.error }, photoError.status);
  const data = new Uint8Array(await photo.arrayBuffer());
  const mimeType = photoMimeType(data);
  if (!mimeType || photo.type !== mimeType) {
    return privateJson({ error: "Upload a JPG, PNG, or WebP photo with a matching image type." }, 415);
  }

  try {
    const analyzer = getHeadlightAnalyzer();
    if (!analyzer) return privateJson({ error: unavailableMessage }, 503);
    const suggestion = await analyzer.analyze({
      vehicle: { model: aiVehicleModel, year },
      photo: { data, mimeType },
    });
    if (!suggestion ||
        !["front_headlight", "unknown"].includes(suggestion.part) ||
        !["left", "right", "unknown"].includes(suggestion.side) ||
        (suggestion.part === "unknown" && suggestion.side !== "unknown")) {
      return privateJson({ error: "The AI service returned an invalid suggestion. Ask the seller to review your photo." }, 502);
    }
    return privateJson({
      analysis: { part: suggestion.part, side: suggestion.side },
      preliminary: true,
      requiresSellerConfirmation: true,
      notice: "This is a preliminary suggestion. A seller must confirm the part, compatibility, and availability.",
    }, 200);
  } catch (error) {
    // Provider errors can include credentials, request bodies, or photo data.
    if (error instanceof AIProviderError && error.kind === "invalid_response") {
      return privateJson({ error: "The AI service returned an invalid suggestion. Ask the seller to review your photo." }, 502);
    }
    return privateJson({ error: unavailableMessage }, 503);
  }
}
