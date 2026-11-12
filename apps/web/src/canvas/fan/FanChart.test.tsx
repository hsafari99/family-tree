import type { TreeGraph } from '@family-tree/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { gl, gp, gu } from '../test-fixtures';
import { FanChart } from './FanChart';

const graph: TreeGraph = {
  mode: 'ancestors',
  focusId: 'leo',
  branchId: null,
  total: 5,
  truncated: false,
  needsBranch: false,
  persons: [
    gp('leo', 'Leo', 1994),
    gp('david', 'David', 1956, { sex: 'male' }),
    gp('laura', 'Laura', 1965, { sex: 'female', canAddRelative: false }),
    gp('robert', 'Robert', 1930, { sex: 'male', deathYear: 1998 }),
    gp('margaret', 'Margaret', 1932, { sex: 'female' }),
  ],
  unions: [gu('u-dl', 'david', 'laura'), gu('u-rm', 'robert', 'margaret')],
  links: [gl('l1', 'u-dl', 'leo'), gl('l2', 'u-rm', 'david')],
};

function setup(selectedId: string | null = null) {
  const on = { open: vi.fn(), add: vi.fn(), recentre: vi.fn() };
  render(
    <FanChart
      graph={graph}
      rootId="leo"
      gens={3}
      selectedId={selectedId}
      onOpen={on.open}
      onAdd={on.add}
      onRecentre={on.recentre}
    />,
  );
  return on;
}

describe('FanChart', () => {
  it('names the chart and draws one segment per known ancestor, with the person in the middle', () => {
    setup();
    expect(
      screen.getByRole('group', { name: 'Fan chart of Leo Hale’s ancestors' }),
    ).toBeInTheDocument();
    for (const name of [
      'David Hale, b. 1956, Father',
      'Laura Hale, b. 1965, Mother',
      'Robert Hale, 1930–1998, Grandfather, father’s side',
      'Margaret Hale, b. 1932, Grandmother, father’s side',
      'Leo Hale, b. 1994',
    ])
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    // 2 + 4 + 8 slots, 4 of them people; the rest dashed.
    expect(document.querySelectorAll('.fan-seg.is-empty')).toHaveLength(10);
  });

  it('opens a person on click or Enter, and re-centres on a double-click', () => {
    const on = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Robert Hale/ }));
    expect(on.open).toHaveBeenCalledWith('robert');
    fireEvent.keyDown(screen.getByRole('button', { name: /^Margaret Hale/ }), { key: 'Enter' });
    expect(on.open).toHaveBeenCalledWith('margaret');
    fireEvent.doubleClick(screen.getByRole('button', { name: /^David Hale/ }));
    expect(on.recentre).toHaveBeenCalledWith('david');
  });

  it('offers + Add on an empty slot whose child may get a parent', () => {
    const on = setup();
    // Robert's parents are unknown: two adds. Laura's are too, but she can't get relatives here.
    const adds = screen.getAllByRole('button', { name: /^Add a parent of/ });
    expect(adds.map((a) => a.getAttribute('aria-label'))).toEqual([
      'Add a parent of Robert Hale',
      'Add a parent of Robert Hale',
      'Add a parent of Margaret Hale',
      'Add a parent of Margaret Hale',
    ]);
    fireEvent.click(adds[0]!);
    expect(on.add).toHaveBeenCalledWith('robert', 'parent');
  });

  it('rings the selected person', () => {
    setup('laura');
    expect(screen.getByRole('button', { name: /^Laura Hale/ })).toHaveClass('is-selected');
    expect(screen.getByRole('button', { name: /^David Hale/ })).not.toHaveClass('is-selected');
    expect(document.querySelectorAll('.fan-sel')).toHaveLength(1);
  });

  it('moves with the arrow keys: up outward to the father, down inward, sideways in the ring', () => {
    setup();
    const focused = () => document.activeElement?.getAttribute('aria-label') ?? '';
    screen.getByRole('button', { name: 'Leo Hale, b. 1994' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(focused()).toMatch(/^David Hale/);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(focused()).toMatch(/^Robert Hale/);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(focused()).toMatch(/^Margaret Hale/);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(focused()).toMatch(/^David Hale/);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(focused()).toMatch(/^Laura Hale/);
  });
});
