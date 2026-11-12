import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePointerCoarse } from './use-pointer';

const stubMedia = (coarse: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => ({
      matches: q === '(pointer: coarse)' && coarse,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );

describe('usePointerCoarse', () => {
  it('is true on a touch screen', () => {
    stubMedia(true);
    expect(renderHook(() => usePointerCoarse()).result.current).toBe(true);
  });
  it('is false with a mouse', () => {
    stubMedia(false);
    expect(renderHook(() => usePointerCoarse()).result.current).toBe(false);
  });
  it('is false where matchMedia is missing', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(renderHook(() => usePointerCoarse()).result.current).toBe(false);
  });
});
