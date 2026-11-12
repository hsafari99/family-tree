import { describe, expect, it } from 'vitest';
import type { Family } from './graph-to-flow';
import { neighbour } from './keyboard-nav';

const fam = (id: string, partnerIds: string[], childIds: string[]): Family => ({
  id,
  partnerIds,
  childIds,
  childLinks: [],
});
//        robert(0,0) — margaret(232,0)
//                 |
//   anna(-232,152)  david(0,152) — laura(232,152)     susan(464,152)
//                       |
//              mia(0,304)  leo(232,304)
const families = [
  fam('u-rm', ['robert', 'margaret'], ['david', 'susan']),
  fam('u-ad', ['anna', 'david'], ['mia']),
  fam('u-dl', ['david', 'laura'], ['leo']),
];
const positions = new Map([
  ['robert', { x: 0, y: 0 }],
  ['margaret', { x: 232, y: 0 }],
  ['anna', { x: -232, y: 152 }],
  ['david', { x: 0, y: 152 }],
  ['laura', { x: 232, y: 153 }],
  ['susan', { x: 464, y: 152 }],
  ['mia', { x: 0, y: 304 }],
  ['leo', { x: 232, y: 304 }],
]);
const go = (dir: Parameters<typeof neighbour>[0], id: string, pos = positions) =>
  neighbour(dir, id, families, pos);

describe('neighbour', () => {
  it('Up: the shown parent closest in x', () => {
    expect(go('up', 'david')).toBe('robert');
    expect(go('up', 'susan')).toBe('margaret');
    expect(go('up', 'leo')).toBe('laura');
  });
  it('Up: skips a parent who is not shown', () => {
    const p = new Map(positions);
    p.delete('margaret');
    expect(go('up', 'susan', p)).toBe('robert');
  });
  it('Down: the shown child closest in x, across all their unions', () => {
    expect(go('down', 'robert')).toBe('david');
    expect(go('down', 'margaret')).toBe('david');
    expect(go('down', 'david')).toBe('mia');
    expect(go('down', 'laura')).toBe('leo');
  });
  it('Left and Right: the nearest card in the same row, that way', () => {
    expect(go('right', 'david')).toBe('laura'); // 1px off the row still counts
    expect(go('right', 'laura')).toBe('susan');
    expect(go('left', 'david')).toBe('anna');
    expect(go('left', 'mia')).toBeNull();
    expect(go('right', 'leo')).toBeNull();
  });
  it('null when there is nobody that way', () => {
    expect(go('up', 'robert')).toBeNull();
    expect(go('down', 'leo')).toBeNull();
    expect(go('left', 'anna')).toBeNull();
    expect(go('up', 'nobody')).toBeNull();
  });
  it('ignores a card outside the row (more than 10px off)', () => {
    const p = new Map(positions);
    p.set('susan', { x: 464, y: 170 });
    expect(go('right', 'laura', p)).toBeNull();
  });
});
