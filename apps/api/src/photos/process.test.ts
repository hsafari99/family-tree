import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  gif,
  jpegWithExif,
  png,
  pngHeaderOnly,
  pngWithTextChunks,
  SECRET,
  webp,
} from '../../test/photo-fixtures.js';
import { PhotoRejected, processPhoto, sniffImageFormat } from './process.js';

const rejected = async (p: Promise<unknown>, reason: string) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(PhotoRejected);
  expect((err as PhotoRejected).reason).toBe(reason);
};

describe('sniffImageFormat', () => {
  it('reads the magic bytes, not names or headers', async () => {
    expect(sniffImageFormat(await jpegWithExif())).toBe('jpeg');
    expect(sniffImageFormat(await png())).toBe('png');
    expect(sniffImageFormat(await webp())).toBe('webp');
    expect(sniffImageFormat(await gif())).toBeNull();
    expect(sniffImageFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImageFormat(Buffer.from([0xff, 0xd8]))).toBeNull(); // too short
    expect(sniffImageFormat(Buffer.from('RIFF\0\0\0\0WAVE'))).toBeNull();
  });
});

describe('processPhoto (spec §8)', () => {
  it('strips EXIF, GPS, XMP and the ICC profile: nothing of the original metadata survives', async () => {
    const input = await jpegWithExif();
    // The fixture really has all of it.
    const inMeta = await sharp(input).metadata();
    expect(inMeta.exif).toBeDefined();
    expect(inMeta.icc).toBeDefined();
    expect(inMeta.xmp?.includes(Buffer.from(SECRET))).toBe(true);
    const out = await processPhoto(input);
    for (const buf of [out.full, out.thumb]) {
      const m = await sharp(buf).metadata();
      expect(m.format).toBe('webp');
      expect(m.exif).toBeUndefined();
      expect(m.xmp).toBeUndefined();
      expect(m.icc).toBeUndefined();
      expect(buf.includes(Buffer.from(SECRET))).toBe(false);
      expect(buf.includes(Buffer.from('TestCam'))).toBe(false);
    }
  });

  it('drops PNG tEXt and eXIf chunks', async () => {
    const input = await pngWithTextChunks();
    expect(input.includes(Buffer.from(SECRET))).toBe(true);
    const out = await processPhoto(input);
    for (const buf of [out.full, out.thumb]) {
      expect(buf.includes(Buffer.from(SECRET))).toBe(false);
      expect((await sharp(buf).metadata()).exif).toBeUndefined();
    }
  });

  it('applies the EXIF orientation to the pixels', async () => {
    const out = await processPhoto(await jpegWithExif({ width: 400, height: 200, orientation: 6 }));
    expect([out.width, out.height]).toEqual([200, 400]);
    expect((await sharp(out.full).metadata()).orientation).toBeUndefined();
  });

  it('makes a 1600 px full version and a 256 px square thumbnail, never enlarging', async () => {
    const big = await processPhoto(await jpegWithExif({ width: 3200, height: 2400 }));
    expect([big.width, big.height]).toEqual([1600, 1200]);
    const t = await sharp(big.thumb).metadata();
    expect([t.width, t.height]).toEqual([256, 256]);
    const small = await processPhoto(await png(300, 200));
    expect([small.width, small.height]).toEqual([300, 200]);
  });

  it('accepts JPEG, PNG and WebP', async () => {
    for (const input of [await jpegWithExif(), await png(), await webp()]) {
      await expect(processPhoto(input)).resolves.toMatchObject({ width: expect.any(Number) });
    }
  });

  it('refuses other types and disguised files', async () => {
    await rejected(processPhoto(await gif()), 'type');
    await rejected(processPhoto(Buffer.from('just text')), 'type');
    // JPEG magic bytes followed by a PNG body: the decoder disagrees with the sniffed type.
    const disguised = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), await png()]);
    await rejected(processPhoto(disguised), 'unreadable');
  });

  it('refuses decompression bombs before decoding, by the header alone', async () => {
    await rejected(processPhoto(pngHeaderOnly(20_000, 20_000)), 'dimensions'); // 400 MP
    await rejected(processPhoto(pngHeaderOnly(12_001, 100)), 'dimensions'); // a side over 12,000
    await rejected(processPhoto(pngHeaderOnly(7_000, 7_000)), 'unreadable'); // 49 MP: allowed, but no pixels
  });

  it('refuses truncated files', async () => {
    const whole = await jpegWithExif({ width: 800, height: 600 });
    await rejected(processPhoto(whole.subarray(0, whole.length >> 1)), 'unreadable');
  });
});
