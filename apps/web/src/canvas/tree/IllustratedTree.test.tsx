import type { TreeGraph } from '@family-tree/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { gl, gp, gu } from '../test-fixtures';
import { IllustratedTree } from './IllustratedTree';

const small: TreeGraph = {
  mode: 'descendants',
  focusId: 'robert',
  branchId: null,
  total: 4,
  truncated: false,
  needsBranch: false,
  persons: [
    gp('robert', 'Robert', 1930, { deathYear: 1998 }),
    gp('margaret', 'Margaret', 1932),
    gp('david', 'David', 1956),
    gp('susan', 'Susan', 1959),
  ],
  unions: [gu('u-rm', 'robert', 'margaret')],
  links: [gl('l1', 'u-rm', 'david'), gl('l2', 'u-rm', 'susan')],
};

const draw = (graph: TreeGraph, selectedId: string | null = null) => {
  const onOpen = vi.fn();
  render(
    <IllustratedTree
      graph={graph}
      rootId="robert"
      gens={4}
      selectedId={selectedId}
      onOpen={onOpen}
    />,
  );
  return onOpen;
};

describe('IllustratedTree', () => {
  it('draws everyone as a button, partners too', () => {
    draw(small);
    expect(
      screen.getByRole('group', { name: 'Illustrated tree of Robert Hale’s descendants' }),
    ).toBeInTheDocument();
    for (const name of [
      'Robert Hale, 1930–1998',
      'Margaret Hale, b. 1932, partner of Robert Hale',
      'David Hale, b. 1956',
      'Susan Hale, b. 1959',
    ])
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(document.querySelectorAll('.tree-branch')).toHaveLength(2);
    expect(screen.queryByText(/This branch is large/)).toBeNull();
  });
  it('opens a person on click or Enter, and rings the selected one', () => {
    const onOpen = draw(small, 'david');
    fireEvent.click(screen.getByRole('button', { name: 'Susan Hale, b. 1959' }));
    expect(onOpen).toHaveBeenCalledWith('susan');
    fireEvent.keyDown(screen.getByRole('button', { name: /^Margaret Hale/ }), { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('margaret');
    expect(screen.getByRole('button', { name: 'David Hale, b. 1956' })).toHaveClass('is-selected');
  });
  it('warns about a large branch but still draws it', () => {
    const kids = Array.from({ length: 85 }, (_, i) => gp(`k${i}`, `Kid${i}`, 1960));
    draw({
      ...small,
      persons: [...small.persons, ...kids],
      links: [...small.links, ...kids.map((k, i) => gl(`lk${i}`, 'u-rm', k.id))],
    });
    expect(screen.getByText(/This branch is large/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kid84 Hale, b. 1960' })).toBeInTheDocument();
  });
});
