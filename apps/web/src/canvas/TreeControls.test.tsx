import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { readCanvasParams } from './params';
import { DepthControl, ViewLinks } from './TreeControls';

const links = (search: string) => {
  cleanup();
  render(
    <MemoryRouter initialEntries={[`/trees/t/people/p${search}`]}>
      <ViewLinks params={readCanvasParams(new URLSearchParams(search))} />
    </MemoryRouter>,
  );
  const group = screen.getByRole('group', { name: 'View' });
  return Object.fromEntries(
    ['Focus', 'Full', 'Fan', 'Tree'].map((n) => {
      const a = screen.getByRole('link', { name: n });
      expect(group).toContainElement(a);
      return [n, { href: a.getAttribute('href'), current: a.getAttribute('aria-current') }];
    }),
  );
};

describe('ViewLinks', () => {
  it('links Focus, Full, Fan and Tree as one group, marking the current one', () => {
    const l = links('?depth=2&focus=x');
    expect(l.Focus).toEqual({ href: '/trees/t/people/p?depth=2&focus=x', current: 'true' });
    expect(l.Full).toEqual({ href: '/trees/t/people/p?depth=2&view=full', current: null });
    expect(l.Fan).toEqual({ href: '/trees/t/people/p?depth=2&focus=x&view=fan', current: null });
    expect(l.Tree!.href).toBe('/trees/t/people/p?depth=2&focus=x&view=tree');
  });
  it('keeps gens across fan and tree, and leaves the branch out of them', () => {
    const l = links('?view=fan&gens=5');
    expect(l.Fan!.current).toBe('true');
    expect(l.Tree!.href).toBe('/trees/t/people/p?view=tree&gens=5');
    expect(links('?view=full&branch=b').Fan!.href).toBe('/trees/t/people/p?view=fan');
  });
});

describe('DepthControl', () => {
  const control = (search: string) => {
    const onChange = vi.fn();
    cleanup();
    render(
      <DepthControl params={readCanvasParams(new URLSearchParams(search))} onChange={onChange} />,
    );
    return { onChange, input: screen.queryByLabelText('Generations') };
  };
  it('is 1 to 3 generations up and down in focus view, absent in full view', () => {
    expect(control('').input).toHaveAttribute('max', '3');
    expect(control('?view=full').input).toBeNull();
  });
  it('is 1 to 6 generations in the fan and tree views, and sets gens', () => {
    const { input, onChange } = control('?view=fan&gens=5');
    expect(input).toHaveAttribute('max', '6');
    expect(input).toHaveValue('5');
    expect(input).toHaveAttribute('aria-valuetext', '5 generations of ancestors');
    fireEvent.change(input!, { target: { value: '6' } });
    expect(onChange).toHaveBeenCalledWith({ gens: 6 });
  });
});
