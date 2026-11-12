import { describe, expect, it } from 'vitest';
import { avatarTone } from './avatar-tone';

describe('avatarTone', () => {
  it('is stable for the same id', () => {
    const id = '3f1c2a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c';
    expect(avatarTone(id)).toBe(avatarTone(id));
  });

  it('spreads 60 random uuids across all six tones', () => {
    const seen = new Map<number, number>();
    for (let i = 0; i < 60; i++) {
      const t = avatarTone(crypto.randomUUID());
      expect(t).toBeGreaterThanOrEqual(1);
      expect(t).toBeLessThanOrEqual(6);
      expect(Number.isInteger(t)).toBe(true);
      seen.set(t, (seen.get(t) ?? 0) + 1);
    }
    expect(seen.size).toBe(6);
    // No tone takes more than a third of them.
    for (const n of seen.values()) expect(n).toBeLessThanOrEqual(20);
  });

  it('handles an empty id', () => {
    expect(avatarTone('')).toBeGreaterThanOrEqual(1);
  });
});
