import { describe, expect, it } from 'vitest';
import { reparentFromReconnect } from './reparent';

const c = (source: string, target: string) => ({
  source,
  target,
  sourceHandle: null,
  targetHandle: null,
});

describe('reparentFromReconnect (brief #13)', () => {
  const child = { id: 'child:L1', source: 'u:U1', target: 'p:K' };
  it('turns a child-edge reconnect onto another dot into a re-parent', () => {
    expect(reparentFromReconnect(child, c('u:U2', 'p:K'))).toEqual({ linkId: 'L1', unionId: 'U2' });
  });
  it('ignores drops on the same dot, on people, or on another target', () => {
    expect(reparentFromReconnect(child, c('u:U1', 'p:K'))).toBeNull();
    expect(reparentFromReconnect(child, c('p:X', 'p:K'))).toBeNull();
    expect(reparentFromReconnect(child, c('u:U2', 'p:Z'))).toBeNull();
    expect(
      reparentFromReconnect(
        { id: 'partner:U1:X', source: 'p:X', target: 'u:U1' },
        c('u:U2', 'u:U1'),
      ),
    ).toBeNull();
  });
});
