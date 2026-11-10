import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FakeLayoutEngine } from '../test/fake-layout';
import { applyElkLayout, toElkGraph } from './elk-graph';
import { FamilyCanvas } from './FamilyCanvas';
import { graphToFlow } from './graph-to-flow';
import { haleGraph } from './test-fixtures';

// jsdom has no layout, so fitView picks a tiny zoom and cards would drop to the dot level.
// Zoom levels are covered by canvas-settings and PersonCard tests; here every card is full.
vi.mock('./canvas-settings', async (orig) => ({
  ...(await orig<typeof import('./canvas-settings')>()),
  cardDetail: () => 'full',
}));

const FAMILY = ['david', 'laura', 'leo', 'mia'];
async function laidOut(without?: string) {
  const g = haleGraph();
  const flow = graphToFlow(
    {
      ...g,
      persons: g.persons.filter((p) => FAMILY.includes(p.id) && p.id !== without),
    },
    { focusId: 'leo', meId: null },
  );
  const laid = await new FakeLayoutEngine().layout(toElkGraph(flow, null));
  return { ...flow, nodes: applyElkLayout(flow.nodes, laid) };
}
const actions = () => ({
  openPerson: vi.fn(),
  addRelative: vi.fn(),
  openUnion: vi.fn(),
  selectedId: null,
});
const DAVID = { name: 'David Hale, b. 1956', hidden: true };
const DOT = 'Relationship of David Hale and Laura Chen (Married)';

describe('FamilyCanvas', () => {
  it('draws cards and union dots, and reports clicks', async () => {
    const flow = await laidOut();
    const a = actions();
    render(<FamilyCanvas {...flow} focusId="leo" actions={a} />);
    const card = await screen.findByRole('button', DAVID);
    expect(
      screen.getByRole('button', {
        name: DOT,
        hidden: true,
      }),
    ).toBeInTheDocument();
    fireEvent.click(card);
    expect(a.openPerson).toHaveBeenCalledWith('david');
    fireEvent.click(
      screen.getByRole('button', {
        name: DOT,
        hidden: true,
      }),
    );
    expect(a.openUnion).toHaveBeenCalledWith('u-dl');
    fireEvent.click(
      screen.getByRole('button', { name: 'Add a child of Laura Chen', hidden: true }),
    );
    expect(a.addRelative).toHaveBeenCalledWith('laura', 'child');
  });

  it('labels the container, has zoom controls, and cards are real buttons', async () => {
    const flow = await laidOut();
    render(<FamilyCanvas {...flow} focusId={null} actions={actions()} />);
    const card = await screen.findByRole('button', DAVID);
    expect(card.tagName).toBe('BUTTON');
    expect(card).toHaveAttribute('type', 'button');
    card.focus();
    expect(document.activeElement).toBe(card);
    expect(document.querySelector('[aria-label="Family tree"]')).not.toBeNull();
    for (const n of ['Zoom In', 'Zoom Out', 'Fit View']) {
      expect(screen.getByRole('button', { name: n, hidden: true })).toBeInTheDocument();
    }
  });

  it('updates when given a new layout', async () => {
    const flow = await laidOut();
    const a = actions();
    const { rerender } = render(<FamilyCanvas {...flow} focusId={null} actions={a} />);
    await screen.findByRole('button', DAVID);
    const next = await laidOut('david');
    rerender(<FamilyCanvas {...next} focusId={null} actions={a} />);
    await vi.waitFor(() => expect(screen.queryByRole('button', DAVID)).toBeNull());
  });
});
