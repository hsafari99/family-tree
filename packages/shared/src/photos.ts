import { z } from 'zod';

/** Spec §8: at most 10 MB; JPEG, PNG or WebP (the server checks the magic bytes). */
export const PHOTO_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoMediaType = (typeof PHOTO_MEDIA_TYPES)[number];
/** Stored sizes (spec §8): the long side of the full version, and the square thumbnail. */
export const PHOTO_FULL_SIDE = 1600;
export const PHOTO_THUMB_SIDE = 256;
/** Decompression-bomb guard (decision 3): larger images are refused before decoding. */
export const PHOTO_MAX_PIXELS = 50_000_000;
export const PHOTO_MAX_SIDE = 12_000;
export const PHOTOS_PER_PERSON_MAX = 50;
/** Signed photo URLs are valid for 15 minutes (spec §8). */
export const PHOTO_URL_TTL_SECONDS = 15 * 60;
/** Why an upload was refused: `details.reason` of the VALIDATION error (decision 15). */
export const PHOTO_REJECT_REASONS = [
  'type',
  'tooLarge',
  'dimensions',
  'unreadable',
  'tooMany',
] as const;
export type PhotoRejectReason = (typeof PHOTO_REJECT_REASONS)[number];

export const photoSchema = z.object({
  id: z.uuid(),
  /** Of the full version. */
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  /** Stored bytes of both versions: what counts towards the tree's quota. */
  bytes: z.number().int().nonnegative(),
  isPrimary: z.boolean(),
  createdAt: z.string(),
  uploadedByName: z.string().nullable(),
  thumbUrl: z.string(),
  fullUrl: z.string(),
});
export type Photo = z.infer<typeof photoSchema>;

export const photoUsageSchema = z.object({
  usedBytes: z.number().int().nonnegative(),
  limitBytes: z.number().int().nonnegative(),
});
export type PhotoUsage = z.infer<typeof photoUsageSchema>;

export const uploadedPhotoSchema = z.object({ photo: photoSchema, usage: photoUsageSchema });
export type UploadedPhoto = z.infer<typeof uploadedPhotoSchema>;
