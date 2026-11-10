import { describe, expect, it } from 'vitest';
import {
  HISTORY_ACTION_PREFIXES,
  PHOTO_FULL_SIDE,
  PHOTO_MAX_PIXELS,
  PHOTO_THUMB_SIDE,
  PHOTO_UPLOAD_MAX_BYTES,
  PHOTO_URL_TTL_SECONDS,
  photoSchema,
  uploadedPhotoSchema,
} from './index.js';

const photo = {
  id: '00000000-0000-4000-8000-000000000001',
  width: 1600,
  height: 1200,
  bytes: 210_000,
  isPrimary: true,
  createdAt: '2026-11-10T10:00:00.000Z',
  uploadedByName: 'Olive Owner',
  thumbUrl: 'http://localhost:8333/family-photos/trees/t/photos/p/thumb.webp?X-Amz-Expires=900',
  fullUrl: 'http://localhost:8333/family-photos/trees/t/photos/p/full.webp?X-Amz-Expires=900',
};

describe('photo limits (spec §8)', () => {
  it('matches the spec', () => {
    expect(PHOTO_UPLOAD_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect([PHOTO_FULL_SIDE, PHOTO_THUMB_SIDE]).toEqual([1600, 256]);
    expect(PHOTO_URL_TTL_SECONDS).toBe(900);
    expect(PHOTO_MAX_PIXELS).toBe(50_000_000);
  });
  it('parses a photo and an upload response', () => {
    expect(photoSchema.parse(photo)).toEqual(photo);
    expect(
      uploadedPhotoSchema.parse({ photo, usage: { usedBytes: 210_000, limitBytes: 1 } }).usage,
    ).toEqual({ usedBytes: 210_000, limitBytes: 1 });
    expect(photoSchema.safeParse({ ...photo, thumbUrl: undefined }).success).toBe(false);
  });
  it('shows photo changes in History', () => {
    expect(HISTORY_ACTION_PREFIXES).toContain('photo.');
  });
});
