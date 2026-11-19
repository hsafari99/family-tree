import { describe, expect, it } from 'vitest';
import { aliasBridge } from './links.js';
import { stepDistances } from './privacy.js';

// My tree: me + wife (the bridge, "wife"). Her tree: her card "w2", her parents, her brother.
const mine = {
  persons: [{ id: 'me' }, { id: 'wife' }],
  unions: [{ id: 'u-me', partnerAId: 'me', partnerBId: 'wife' }],
  parentChild: [] as { id: string; unionId: string; childId: string }[],
};
const hers = {
  persons: [{ id: 'w2' }, { id: 'wf' }, { id: 'wm' }, { id: 'bro' }],
  unions: [{ id: 'u-wp', partnerAId: 'wf', partnerBId: 'wm' }],
  parentChild: [
    { id: 'l1', unionId: 'u-wp', childId: 'w2' },
    { id: 'l2', unionId: 'u-wp', childId: 'bro' },
  ],
};

describe('aliasBridge', () => {
  it('drops the linked bridge card and hangs its relations off my bridge card', () => {
    const joined = aliasBridge(hers, 'w2', 'wife');
    expect(joined.persons.map((p) => p.id)).toEqual(['wf', 'wm', 'bro']);
    expect(joined.parentChild.map((l) => l.childId)).toEqual(['wife', 'bro']);
  });

  it('rewrites a partner slot too', () => {
    const joined = aliasBridge(
      { persons: [{ id: 'w2' }], unions: [{ partnerAId: 'x', partnerBId: 'w2' }], parentChild: [] },
      'w2',
      'wife',
    );
    expect(joined.unions[0]).toEqual({ partnerAId: 'x', partnerBId: 'wife' });
  });

  it('counts steps across the bridge as one person (V3): my wife’s brother is 2 steps', () => {
    const linked = aliasBridge(hers, 'w2', 'wife');
    const d = stepDistances(
      {
        unions: [...mine.unions, ...linked.unions],
        parentChild: [...mine.parentChild, ...linked.parentChild],
      },
      'me',
      10,
    );
    expect(d.get('wife')).toBe(1);
    expect(d.get('bro')).toBe(2);
    expect(d.get('wf')).toBe(2);
  });
});
