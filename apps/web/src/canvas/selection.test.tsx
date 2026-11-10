import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createSelectionStore, useIsSelected } from './selection';

describe('selection store', () => {
  it('re-renders only the cards whose selected state changes', () => {
    const store = createSelectionStore('a');
    const renders: Record<string, number> = { a: 0, b: 0, c: 0 };
    function Card({ id }: { id: string }) {
      renders[id]! += 1;
      return <span>{String(useIsSelected(store, id))}</span>;
    }
    const { container } = render(
      <>
        <Card id="a" />
        <Card id="b" />
        <Card id="c" />
      </>,
    );
    expect(container.textContent).toBe('truefalsefalse');
    act(() => store.set('b'));
    expect(container.textContent).toBe('falsetruefalse');
    expect(renders).toEqual({ a: 2, b: 2, c: 1 });
  });
});
