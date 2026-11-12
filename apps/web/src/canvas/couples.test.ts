import { describe, expect, it } from 'vitest';
import { coupleChangeAfterDrop, type Couple, seatCouples } from './couples';
import { CARD_WIDTH } from './graph-to-flow';

const GAP = 32;
const STEP = CARD_WIDTH + GAP;
type Pos = { x: number; y: number };
const row = (xs: Record<string, number>, y = 0): Map<string, Pos> =>
  new Map(Object.entries(xs).map(([id, x]) => [`p:${id}`, { x, y }]));
const couple = (
  unionId: string,
  a: string,
  b: string,
  aOrder: number | null = null,
  bOrder: number | null = null,
): Couple => ({
  unionId,
  a: `p:${a}`,
  b: `p:${b}`,
  aOrder,
  bOrder,
});
const x = (pos: Map<string, Pos>, id: string) => pos.get(`p:${id}`)!.x;
const order = (pos: Map<string, Pos>, y = 0) =>
  [...pos]
    .filter(([, p]) => p.y === y)
    .sort(([, p], [, q]) => p.x - q.x)
    .map(([id]) => id.slice(2));

describe('seatCouples', () => {
  const BLOOD = new Set(['p:ann', 'p:ben', 'p:cat']);

  it('seats a couple together, between the siblings around them', () => {
    const pos = row({ xan: 0, ann: 216, ben: 432, cat: 648 });
    seatCouples(pos, [couple('U', 'ben', 'xan')], BLOOD, GAP);
    expect(order(pos)).toEqual(['ann', 'ben', 'xan', 'cat']);
    expect(Math.abs(x(pos, 'ben') - x(pos, 'xan'))).toBe(STEP);
  });

  it('puts partner a on the left, or b when the slots are swapped', () => {
    const a = row({ xan: 0, ann: 216, ben: 432, cat: 648 });
    seatCouples(a, [couple('U', 'ben', 'xan')], BLOOD, GAP);
    expect(x(a, 'ben')).toBeLessThan(x(a, 'xan'));
    const b = row({ xan: 0, ann: 216, ben: 432, cat: 648 });
    seatCouples(b, [couple('U', 'xan', 'ben')], BLOOD, GAP);
    expect(x(b, 'xan')).toBeLessThan(x(b, 'ben'));
    expect(order(b)).toEqual(['ann', 'xan', 'ben', 'cat']);
  });

  it("seats a three-chain by the hub's own order only", () => {
    const xs = { laura: 0, anna: 216, david: 432 };
    const blood = new Set(['p:david']);
    const a = row(xs);
    seatCouples(
      a,
      [couple('da', 'david', 'anna', 1, 9), couple('dl', 'david', 'laura', 2, 1)],
      blood,
      GAP,
    );
    expect(order(a)).toEqual(['anna', 'david', 'laura']);
    const b = row(xs);
    seatCouples(
      b,
      [couple('da', 'david', 'anna', 2, 1), couple('dl', 'david', 'laura', 1, 9)],
      blood,
      GAP,
    );
    expect(order(b)).toEqual(['laura', 'david', 'anna']);
    // The hub in slot b reads bOrder.
    const c = row(xs);
    seatCouples(
      c,
      [couple('da', 'anna', 'david', 1, 2), couple('dl', 'laura', 'david', 2, 1)],
      blood,
      GAP,
    );
    expect(order(c)).toEqual(['laura', 'david', 'anna']);
  });

  it('returns the shift of every person it moved, and only those', () => {
    const pos = row({ ann: 0, ben: 216, xan: 432 });
    const moved = seatCouples(pos, [couple('U', 'ben', 'xan')], BLOOD, GAP);
    expect(moved.size).toBe(0);
    const pos2 = row({ ann: 0, ben: 216, xan: 600 });
    const moved2 = seatCouples(pos2, [couple('U', 'ben', 'xan')], BLOOD, GAP);
    expect(moved2.has('p:ann')).toBe(false);
    expect(x(pos2, 'xan') - x(pos2, 'ben')).toBe(STEP);
    for (const [id, dx] of moved2) {
      expect(dx).not.toBe(0);
      expect(pos2.has(id)).toBe(true);
    }
    expect(moved2.get('p:xan')! + 600).toBe(x(pos2, 'xan'));
  });

  it('never overlaps groups, and keeps every card at least gap apart', () => {
    const pos = row({ a1: 0, b1: 10, a2: 20, b2: 30, c: 40, a3: 50, b3: 60, d: 70 });
    seatCouples(
      pos,
      [
        couple('1', 'a1', 'b1'),
        couple('2', 'a2', 'b2'),
        couple('3', 'a3', 'b3'),
        couple('4', 'b3', 'd'),
      ],
      new Set(),
      GAP,
    );
    const xs = [...pos.values()].map((p) => p.x).sort((m, n) => m - n);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(STEP);
  });

  it('leaves other rows alone, and a couple split across rows', () => {
    const pos = new Map([...row({ ann: 0, ben: 216 }), ...row({ xan: 1000, zed: 10 }, 200)]);
    const moved = seatCouples(pos, [couple('U', 'ben', 'xan')], BLOOD, GAP);
    expect(moved.size).toBe(0);
    expect(x(pos, 'xan')).toBe(1000);
  });
});

describe('coupleChangeAfterDrop (brief #16)', () => {
  it('a dragged partner past the other one swaps the couple', () => {
    const couples = [couple('U', 'ben', 'xan')];
    const at = (ben: number) =>
      new Map([
        ['p:ben', ben],
        ['p:xan', 216],
      ]);
    expect(coupleChangeAfterDrop(couples, 'p:ben', at(400))).toEqual({
      kind: 'swap',
      unionId: 'U',
    });
    expect(coupleChangeAfterDrop(couples, 'p:ben', at(100))).toBeNull();
    // Partner b starts on the right: dragging it left past a swaps.
    expect(
      coupleChangeAfterDrop(
        couples,
        'p:xan',
        new Map([
          ['p:ben', 0],
          ['p:xan', -50],
        ]),
      ),
    ).toEqual({
      kind: 'swap',
      unionId: 'U',
    });
  });

  it("an end of a three-chain dragged past the hub reverses the hub's order", () => {
    const couples = [
      couple('da', 'david', 'anna', 1, null),
      couple('dl', 'david', 'laura', 2, null),
    ];
    const x = (anna: number) =>
      new Map([
        ['p:anna', anna],
        ['p:david', 216],
        ['p:laura', 432],
      ]);
    expect(coupleChangeAfterDrop(couples, 'p:anna', x(700))).toEqual({
      kind: 'unionOrder',
      personId: 'david',
      unionIds: ['dl', 'da'],
    });
    expect(coupleChangeAfterDrop(couples, 'p:anna', x(100))).toBeNull();
    const laura = new Map([
      ['p:anna', 0],
      ['p:david', 216],
      ['p:laura', 10],
    ]);
    expect(coupleChangeAfterDrop(couples, 'p:laura', laura)).toEqual({
      kind: 'unionOrder',
      personId: 'david',
      unionIds: ['dl', 'da'],
    });
  });

  it('snaps back for the hub itself, a single person, or a partner not on screen', () => {
    const couples = [couple('da', 'david', 'anna'), couple('dl', 'david', 'laura')];
    const x = new Map([
      ['p:anna', 0],
      ['p:david', 900],
      ['p:laura', 432],
    ]);
    expect(coupleChangeAfterDrop(couples, 'p:david', x)).toBeNull();
    expect(coupleChangeAfterDrop(couples, 'p:zed', x)).toBeNull();
    const alone = new Map([['p:ben', 900]]);
    expect(coupleChangeAfterDrop([couple('U', 'ben', 'xan')], 'p:ben', alone)).toBeNull();
  });
});
