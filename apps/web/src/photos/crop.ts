import { PHOTO_FULL_SIDE } from '@family-tree/shared';

export interface Size {
  width: number;
  height: number;
}
/** A square in the image's own pixels (after EXIF orientation, as browsers display it). */
export interface CropBox {
  x: number;
  y: number;
  size: number;
}
export const ZOOM_MAX = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const place = (img: Size, x: number, y: number, size: number): CropBox => ({
  x: Math.round(clamp(x, 0, img.width - size)),
  y: Math.round(clamp(y, 0, img.height - size)),
  size,
});

export function initialCrop(img: Size): CropBox {
  const size = Math.min(img.width, img.height);
  return place(img, (img.width - size) / 2, (img.height - size) / 2, size);
}

/** A square of 1/zoom of the short side, around the same centre. */
export function zoomCrop(box: CropBox, img: Size, zoom: number): CropBox {
  const size = Math.max(1, Math.round(Math.min(img.width, img.height) / clamp(zoom, 1, ZOOM_MAX)));
  return place(img, box.x + box.size / 2 - size / 2, box.y + box.size / 2 - size / 2, size);
}

export const moveCrop = (box: CropBox, img: Size, dx: number, dy: number) =>
  place(img, box.x + dx, box.y + dy, box.size);

/**
 * The crop drawn at most `maxSide` px and encoded as JPEG 0.92; with no box, the file itself.
 * The server re-encodes either way (decision 5), so this only saves upload time.
 */
export async function cropToBlob(
  file: Blob,
  box: CropBox | null,
  maxSide = PHOTO_FULL_SIDE,
): Promise<Blob> {
  if (!box) return file;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const side = Math.min(box.size, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.drawImage(bitmap, box.x, box.y, box.size, box.size, 0, 0, side, side);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('encode failed'))),
        'image/jpeg',
        0.92,
      ),
    );
  } finally {
    bitmap.close();
  }
}
