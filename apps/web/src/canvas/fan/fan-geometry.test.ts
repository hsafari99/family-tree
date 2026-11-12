import { describe, expect, it } from 'vitest';
import { FAN_SPAN, fanGeometry } from './fan-geometry';

describe('fanGeometry', () => {
  const slots = fanGeometry({ gens: 6, cx: 500, cy: 480, r0: 72, ring: 86 });
  it('has 2^g slots in generation g, numbered from 2', () => {
    for (let g = 1; g <= 6; g++) expect(slots.filter((s) => s.gen === g)).toHaveLength(2 ** g);
    expect(slots.map((s) => s.n)).toEqual(Array.from({ length: 126 }, (_, i) => i + 2));
  });
  it('fills the span in every ring, father’s side first', () => {
    for (let g = 1; g <= 6; g++) {
      const ring = slots.filter((s) => s.gen === g);
      const total = ring.reduce((t, s) => t + (s.a2 - s.a1), 0);
      expect(total).toBeCloseTo(FAN_SPAN);
      expect(ring[0]!.a1).toBeLessThan(ring.at(-1)!.a1);
    }
    expect(slots.find((s) => s.n === 2)!.side).toBe('pat');
    expect(slots.find((s) => s.n === 7)!.side).toBe('mat');
  });
  it('rings grow outward and thin out past generation 4, and nothing is NaN', () => {
    const width = (g: number) => {
      const s = slots.find((x) => x.gen === g)!;
      return s.r2 - s.r1;
    };
    expect(width(5)).toBeLessThan(width(3));
    expect(slots.find((s) => s.gen === 2)!.r1).toBe(slots.find((s) => s.gen === 1)!.r2);
    for (const s of slots) {
      expect(s.path).not.toMatch(/NaN/);
      for (const v of [s.labelX, s.labelY, s.rotate]) expect(Number.isFinite(v)).toBe(true);
    }
  });
  it('turns text tangential near the centre and radial, readable left to right, outside', () => {
    const s2 = slots.find((s) => s.n === 2)!;
    const mid = ((s2.a1 + s2.a2) / 2) * (180 / Math.PI);
    expect(s2.rotate).toBeCloseTo(mid + 90);
    for (const s of slots.filter((x) => x.gen >= 3)) {
      expect(s.rotate).toBeGreaterThanOrEqual(-90);
      expect(s.rotate).toBeLessThanOrEqual(90);
    }
  });
});
