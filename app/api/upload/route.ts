import { NextResponse } from "next/server";
import { authed, handleError, jsonError } from "@/lib/api";

const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 10 * 1024 * 1024;

/** A photo attached in the chat → the site's media library. */
export async function POST(request: Request) {
  const auth = await authed(request);
  if (auth.error) return auth.error;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError(400, "Choose a photo to upload.");
  if (!TYPES.includes(file.type)) return jsonError(400, "Photos must be JPEG, PNG, WebP or GIF.");
  if (file.size > MAX_BYTES) return jsonError(400, "Photos must be 10 MB or smaller.");
  try {
    const media = await auth.wp.uploadMedia(Buffer.from(await file.arrayBuffer()), file.type, file.name || "photo.jpg");
    return NextResponse.json(media, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
