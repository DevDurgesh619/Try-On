export const MAX_LONG_EDGE_PX = 1024;

export interface CompressedImage {
  data_url: string;
  width: number;
  height: number;
}

/**
 * Decode a data URL or blob URL into an HTMLImageElement.
 * Browser-only — relies on the Image() and createImageBitmap APIs.
 */
async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = (): void => resolve(img);
    img.onerror = (): void => reject(new Error('image_decode_failed'));
    img.src = src;
  });
}

/**
 * Resize a source image so its long edge is at most `maxLongEdge`, then
 * re-encode as JPEG at the given quality. Returns a data URL.
 * DOM-only — uses Image and HTMLCanvasElement.
 */
export async function compressImage(
  src: string,
  maxLongEdge: number = MAX_LONG_EDGE_PX,
  quality = 0.9,
): Promise<CompressedImage> {
  const img = await loadImage(src);
  const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_2d_unavailable');
  ctx.drawImage(img, 0, 0, width, height);
  const data_url = canvas.toDataURL('image/jpeg', quality);
  return { data_url, width, height };
}

/**
 * Service-worker-safe variant of {@link compressImage}. Uses createImageBitmap
 * and OffscreenCanvas — no DOM. Returns a Blob you can read as a data URL.
 */
export async function compressBlob(
  blob: Blob,
  maxLongEdge: number = MAX_LONG_EDGE_PX,
  quality = 0.9,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const longEdge = Math.max(bitmap.width, bitmap.height);
  const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('offscreen_canvas_2d_unavailable');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return { blob: out, width, height };
}
