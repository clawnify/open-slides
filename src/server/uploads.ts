let _bucket: R2Bucket;

export function initUploads(bucket: R2Bucket) {
  _bucket = bucket;
}

// ── built-in image placeholder ───────────────────────────────────────
// `assets/placeholder.svg` is a VIRTUAL asset: it has no R2 object and no
// assets row, it's served from this constant. Slides/templates reference it
// for image slots the user fills later ("client hero photo") — it renders as
// a neutral photo box, and clicking it in the editor opens the picker and
// swaps in a real upload. Handled here (not in a route) so every consumer —
// the /api/uploads route, PDF inlining, logo resolution — resolves it alike.
export const PLACEHOLDER_KEY = "placeholder.svg";
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450">
<rect width="800" height="450" fill="#E9E7E2"/>
<g fill="none" stroke="#A9A59D" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
<rect x="336" y="156" width="128" height="96" rx="10"/>
<path d="M348 232 L382 198 L406 222 L424 204 L452 232"/>
</g>
<circle cx="368" cy="184" r="9" fill="#A9A59D"/>
<text x="400" y="296" text-anchor="middle" font-family="-apple-system,system-ui,sans-serif" font-size="26" fill="#8E8A82">Click to add image</text>
</svg>`;
const placeholderBytes = () => new TextEncoder().encode(PLACEHOLDER_SVG);

export async function putUpload(
  key: string,
  data: ArrayBuffer | Uint8Array | ReadableStream,
  contentType: string,
): Promise<void> {
  await _bucket.put(key, data, { httpMetadata: { contentType } });
}

export async function getUpload(
  key: string,
): Promise<{ data: ReadableStream; contentType: string; size: number } | null> {
  if (key === PLACEHOLDER_KEY) {
    const bytes = placeholderBytes();
    return { data: new Blob([bytes]).stream(), contentType: "image/svg+xml", size: bytes.byteLength };
  }
  const obj = await _bucket.get(key);
  if (!obj) return null;
  return {
    data: obj.body,
    contentType: obj.httpMetadata?.contentType || "application/octet-stream",
    size: obj.size,
  };
}

export async function getUploadBytes(
  key: string,
): Promise<{ data: ArrayBuffer; contentType: string } | null> {
  if (key === PLACEHOLDER_KEY) {
    const bytes = placeholderBytes();
    return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, contentType: "image/svg+xml" };
  }
  const obj = await _bucket.get(key);
  if (!obj) return null;
  return {
    data: await obj.arrayBuffer(),
    contentType: obj.httpMetadata?.contentType || "application/octet-stream",
  };
}

export async function deleteUpload(key: string): Promise<void> {
  await _bucket.delete(key);
}

/** Filesystem-safe, collision-resistant key from an original filename. */
export function makeKey(filename: string): string {
  const clean = filename.toLowerCase().replace(/[^a-z0-9.\-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || "file";
}
