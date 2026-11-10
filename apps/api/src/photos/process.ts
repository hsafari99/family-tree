import {
  PHOTO_FULL_SIDE,
  PHOTO_MAX_PIXELS,
  PHOTO_MAX_SIDE,
  PHOTO_THUMB_SIDE,
} from '@family-tree/shared';
import sharp from 'sharp';

// Every upload is a new image: libvips' operation cache would only hold memory.
sharp.cache(false);

export type ImageFormat = 'jpeg' | 'png' | 'webp';

/** The format from the first bytes (spec §8: checked by magic bytes, not name or Content-Type). */
export function sniffImageFormat(b: Uint8Array): ImageFormat | null {
  const at = (offset: number, ...bytes: number[]) => bytes.every((x, i) => b[offset + i] === x);
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'jpeg';
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) {
    return 'webp'; // "RIFF" …size… "WEBP"
  }
  return null;
}

export type RejectReason = 'type' | 'dimensions' | 'unreadable';
export class PhotoRejected extends Error {
  override name = 'PhotoRejected';
  constructor(readonly reason: RejectReason) {
    super(`photo rejected: ${reason}`);
  }
}

export interface ProcessedPhoto {
  full: Buffer;
  thumb: Buffer;
  /** Of the full version, after orientation. */
  width: number;
  height: number;
}

const open = (buf: Buffer) =>
  sharp(buf, {
    // libvips refuses larger images in metadata() and when decoding (decision 3).
    limitInputPixels: PHOTO_MAX_PIXELS,
    failOn: 'error',
    animated: false,
    autoOrient: true,
    sequentialRead: true,
  }).timeout({ seconds: 30 });

const reasonOf = (err: unknown): RejectReason =>
  err instanceof Error && /pixel limit/i.test(err.message) ? 'dimensions' : 'unreadable';

/**
 * Re-encodes an upload (decisions 3–4). The output is WebP with no metadata at all: sharp writes
 * no EXIF (so no GPS), XMP or ICC unless asked to, and autoOrient turns the EXIF orientation into
 * pixels first. Type, size and dimensions are checked before any pixels are decoded.
 */
export async function processPhoto(buf: Buffer): Promise<ProcessedPhoto> {
  const format = sniffImageFormat(buf);
  if (!format) throw new PhotoRejected('type');
  let meta: sharp.Metadata;
  try {
    meta = await open(buf).metadata();
  } catch (err) {
    throw new PhotoRejected(reasonOf(err));
  }
  if (meta.format !== format) throw new PhotoRejected('unreadable');
  const { width, height } = meta;
  if (
    !width ||
    !height ||
    width > PHOTO_MAX_SIDE ||
    height > PHOTO_MAX_SIDE ||
    width * height > PHOTO_MAX_PIXELS
  ) {
    throw new PhotoRejected('dimensions');
  }
  try {
    const full = await open(buf)
      .resize({
        width: PHOTO_FULL_SIDE,
        height: PHOTO_FULL_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    // If the attention crop errors with sequentialRead (Task 1 Step 4), open the thumbnail without it.
    const thumb = await open(buf)
      .resize({
        width: PHOTO_THUMB_SIDE,
        height: PHOTO_THUMB_SIDE,
        fit: 'cover',
        position: 'attention',
      })
      .webp({ quality: 78 })
      .toBuffer();
    return { full: full.data, thumb, width: full.info.width, height: full.info.height };
  } catch (err) {
    throw new PhotoRejected(reasonOf(err));
  }
}
