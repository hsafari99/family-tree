import { slotSide } from './ahnentafel';

/** The fan covers 200°, centred at the top (Task 18, the mockup's drawFan). */
export const FAN_SPAN = (200 * Math.PI) / 180;
const A0 = (-190 * Math.PI) / 180;

export interface FanSlot {
  /** Ahnentafel number. */
  n: number;
  gen: number;
  side: 'pat' | 'mat';
  /** Angles in radians and radii of the ring segment. */
  a1: number;
  a2: number;
  r1: number;
  r2: number;
  path: string;
  labelX: number;
  labelY: number;
  /** Degrees: tangential for generations 1–2, radial (flipped to read left to right) beyond. */
  rotate: number;
}

/** A ring's width: full for the first three generations, then thinner. */
export const ringWidth = (gen: number, ring: number) =>
  gen <= 3 ? ring : gen === 4 ? ring * 0.85 : ring * 0.62;

/** The outer radius of generation `gen`'s ring. */
export function fanRadius(gen: number, r0: number, ring: number): number {
  let r = r0;
  for (let g = 1; g <= gen; g++) r += ringWidth(g, ring);
  return r;
}

const f = (v: number) => v.toFixed(1);

export function fanGeometry({
  gens,
  cx,
  cy,
  r0,
  ring,
}: {
  gens: number;
  cx: number;
  cy: number;
  r0: number;
  ring: number;
}): FanSlot[] {
  const pt = (r: number, a: number) => `${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`;
  const out: FanSlot[] = [];
  for (let g = 1; g <= gens; g++) {
    const count = 2 ** g;
    const r1 = fanRadius(g - 1, r0, ring);
    const r2 = fanRadius(g, r0, ring);
    for (let i = 0; i < count; i++) {
      const n = count + i;
      const a1 = A0 + (FAN_SPAN * i) / count;
      const a2 = A0 + (FAN_SPAN * (i + 1)) / count;
      const large = a2 - a1 > Math.PI ? 1 : 0;
      const path =
        `M${pt(r2, a1)} A${f(r2)} ${f(r2)} 0 ${large} 1 ${pt(r2, a2)} ` +
        `L${pt(r1, a2)} A${f(r1)} ${f(r1)} 0 ${large} 0 ${pt(r1, a1)}Z`;
      const am = (a1 + a2) / 2;
      const rm = (r1 + r2) / 2;
      const deg = (am * 180) / Math.PI;
      out.push({
        n,
        gen: g,
        side: slotSide(n),
        a1,
        a2,
        r1,
        r2,
        path,
        labelX: cx + rm * Math.cos(am),
        labelY: cy + rm * Math.sin(am),
        rotate: g <= 2 ? deg + 90 : deg < -90 ? deg + 180 : deg,
      });
    }
  }
  return out;
}
