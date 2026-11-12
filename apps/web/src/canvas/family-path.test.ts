import { describe, expect, it } from 'vitest';
import { childPath, partnerPath } from './family-path';

describe('partnerPath', () => {
  it('is a straight line from the card side to the dot', () => {
    expect(partnerPath(200, 36, 216, 36)).toBe('M 200 36 L 216 36');
    expect(partnerPath(440, 36, 424, 36)).toBe('M 440 36 L 424 36');
  });
});

describe('childPath', () => {
  it('goes straight down when the child is under the dot', () => {
    expect(childPath(100, 0, 100, 80)).toBe('M 100 0 L 100 80');
  });

  it('turns right along a shared rail midway down, with rounded corners', () => {
    expect(childPath(100, 0, 300, 80)).toBe(
      'M 100 0 L 100 28 Q 100 40 112 40 L 288 40 Q 300 40 300 52 L 300 80',
    );
  });

  it('turns left the same way', () => {
    expect(childPath(300, 0, 100, 80)).toBe(
      'M 300 0 L 300 28 Q 300 40 288 40 L 112 40 Q 100 40 100 52 L 100 80',
    );
  });

  it('clamps the radius to half a small sideways offset', () => {
    expect(childPath(100, 0, 106, 80)).toBe(
      'M 100 0 L 100 37 Q 100 40 103 40 L 103 40 Q 106 40 106 43 L 106 80',
    );
  });

  it('puts siblings on the same rail', () => {
    const rail = (d: string) => d.split(' Q ')[1]!.split(' ')[3];
    expect(rail(childPath(100, 0, 20, 80))).toBe(rail(childPath(100, 0, 260, 80)));
  });

  it('takes a custom radius', () => {
    expect(childPath(0, 0, 100, 100, 4)).toBe(
      'M 0 0 L 0 46 Q 0 50 4 50 L 96 50 Q 100 50 100 54 L 100 100',
    );
  });
});
