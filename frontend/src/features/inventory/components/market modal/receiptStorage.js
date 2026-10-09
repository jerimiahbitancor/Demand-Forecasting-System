// components/market modal/receiptStorage.js
//
// Uploads the confirmed receipt to the Supabase Storage bucket "receipts",
// keyed {ingredientId}/{ISO-timestamp}.jpg|.pdf (one copy per ingredient,
// all copies of one receipt share the same timestamp), and returns the
// public URL that gets stored in market_price.receipt_url.
import { supabase } from "../../../../config/supabase";

const BUCKET = "receipts";

// Phone cameras hand us 12 MP HEIC/JPEG files. Re-encoding keeps storage
// (and the review screen's network) sane and lets the object key always end
// in .jpg whatever format the camera produced.
const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.85;

const toJpegBlob = async (file) => {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close?.();
      return file;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    return blob || file;
  } catch {
    // Older WebKit without createImageBitmap, or a decode failure: uploading
    // the original bytes beats losing the receipt.
    return file;
  }
};

// ISO timestamps contain ":" which some object stores reject and which has
// to be percent-encoded in every URL, so the separators are flattened while
// keeping the value sortable and unique per receipt.
export const receiptTimestamp = () => new Date().toISOString().replace(/[:.]/g, "-");

export async function uploadReceiptFile(file, ingredientId, timestamp) {
  if (!file) throw new Error("No receipt file selected");
  if (!ingredientId) throw new Error("Missing ingredient id for the receipt path");

  // PDFs upload byte-for-byte (pdf.js already read them locally); photos
  // are re-encoded to JPEG to keep storage and review-screen downloads
  // sane whatever format the camera produced.
  const isPdf =
    file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
  const blob = isPdf ? file : await toJpegBlob(file);
  const path = `${ingredientId}/${timestamp}.${isPdf ? "pdf" : "jpg"}`;

  // upsert: a retry after a partial failure re-uses the same path, and
  // without it the second attempt would fail with "already exists".
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, {
      contentType: isPdf ? "application/pdf" : "image/jpeg",
      upsert: true,
    });

  if (error) {
    throw new Error(error.message || "Could not upload the receipt file");
  }

  const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = publicData && publicData.publicUrl;
  if (!publicUrl) throw new Error("Could not build the receipt URL");

  return publicUrl;
}
