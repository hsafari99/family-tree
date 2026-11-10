import { afterEach, describe, expect, it, vi } from 'vitest';
import { cropToBlob, initialCrop, moveCrop, zoomCrop } from './crop';

const img = { width: 400, height: 200 };

describe('square crop (decision 5)', () => {
  it('starts with the largest centred square', () => {
    expect(initialCrop(img)).toEqual({ x: 100, y: 0, size: 200 });
    expect(initialCrop({ width: 300, height: 900 })).toEqual({ x: 0, y: 300, size: 300 });
  });
  it('zooms around the centre and stays inside the image', () => {
    expect(zoomCrop(initialCrop(img), img, 2)).toEqual({ x: 150, y: 50, size: 100 });
    expect(zoomCrop({ x: 300, y: 100, size: 100 }, img, 1)).toEqual({ x: 200, y: 0, size: 200 });
    expect(zoomCrop(initialCrop(img), img, 99).size).toBe(50); // at most ZOOM_MAX (4)
  });
  it('moves and clamps', () => {
    expect(moveCrop({ x: 150, y: 50, size: 100 }, img, 30, -10)).toEqual({
      x: 180,
      y: 40,
      size: 100,
    });
    expect(moveCrop({ x: 150, y: 50, size: 100 }, img, 999, 999)).toEqual({
      x: 300,
      y: 100,
      size: 100,
    });
    expect(moveCrop({ x: 150, y: 50, size: 100 }, img, -999, -999)).toEqual({
      x: 0,
      y: 0,
      size: 100,
    });
  });
  it('sends the file unchanged without a crop', async () => {
    const f = new Blob(['x'], { type: 'image/png' });
    expect(await cropToBlob(f, null)).toBe(f);
  });
});

describe('cropToBlob transparency', () => {
  afterEach(() => vi.restoreAllMocks());

  it('paints white before drawing, so a transparent PNG does not turn black as JPEG', async () => {
    const calls: string[] = [];
    const ctx = {
      set fillStyle(v: string) {
        calls.push(`fillStyle:${v}`);
      },
      fillRect: () => calls.push('fillRect'),
      drawImage: () => calls.push('drawImage'),
    };
    vi.stubGlobal('createImageBitmap', async () => ({ close: () => {} }));
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: (cb: (b: Blob) => void) => cb(new Blob(['j'])),
    };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLElement);
    await cropToBlob(new Blob(['x']), { x: 0, y: 0, size: 100 });
    expect(calls).toEqual(['fillStyle:#fff', 'fillRect', 'drawImage']);
    vi.unstubAllGlobals();
  });
});
