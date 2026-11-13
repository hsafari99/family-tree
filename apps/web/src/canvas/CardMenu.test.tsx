import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardMenuItems, type CardMenuActions } from './CardMenu';
import { PersonCardView } from './PersonCard';
import { gp } from './test-fixtures';

const robert = gp('robert', 'Robert', 1930, { hasParents: true });

function setup(person = robert) {
  const actions: CardMenuActions = {
    openPerson: vi.fn(),
    focusPerson: vi.fn(),
    addRelative: vi.fn(),
    howRelated: vi.fn(),
  };
  const onOpen = vi.fn();
  render(
    <PersonCardView
      person={person}
      detail="full"
      isFocus={false}
      isMe={false}
      onOpen={onOpen}
      onAdd={vi.fn()}
      menu={cardMenuItems(person, actions)}
    />,
  );
  const open = screen.getByRole('button', { name: /^Robert Hale/ });
  return { actions, onOpen, open };
}
const menu = () => screen.queryByRole('menu', { name: 'Actions for Robert Hale' });
const names = () => screen.getAllByRole('menuitem').map((b) => b.textContent);

afterEach(() => vi.useRealTimers());

describe('card menu', () => {
  it('opens on right-click with the items, the first one focused', () => {
    const { open } = setup();
    const e = fireEvent.contextMenu(open, { clientX: 120, clientY: 80 });
    expect(e).toBe(false); // the browser's own menu is prevented
    expect(menu()).toBeInTheDocument();
    expect(names()).toEqual([
      'Open details',
      'Focus on this person',
      'Add parent',
      'Add partner',
      'Add child',
      'Add sibling',
      'How are we related?',
    ]);
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
  });

  it('hides the Add items without permission to add', () => {
    setup({ ...robert, canAddRelative: false });
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Robert Hale/ }));
    expect(names()).toEqual(['Open details', 'Focus on this person', 'How are we related?']);
  });

  it('runs each item and closes', () => {
    const { actions, open } = setup();
    const choose = (label: string) => {
      fireEvent.contextMenu(open);
      fireEvent.click(screen.getByRole('menuitem', { name: label }));
      expect(menu()).toBeNull();
    };
    choose('Open details');
    expect(actions.openPerson).toHaveBeenCalledWith('robert');
    choose('Focus on this person');
    expect(actions.focusPerson).toHaveBeenCalledWith('robert');
    for (const [label, as] of [
      ['Add parent', 'parent'],
      ['Add partner', 'partner'],
      ['Add child', 'child'],
      ['Add sibling', 'sibling'],
    ] as const) {
      choose(label);
      expect(actions.addRelative).toHaveBeenLastCalledWith('robert', as);
    }
    choose('How are we related?');
    expect(actions.howRelated).toHaveBeenCalledWith('robert');
    // Focus went back to the card.
    expect(open).toHaveFocus();
  });

  it('opens with Shift+F10 and with the ContextMenu key on the focused card', () => {
    const { open } = setup();
    open.focus();
    fireEvent.keyDown(open, { key: 'F10', shiftKey: true });
    expect(menu()).toBeInTheDocument();
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0]!, { key: 'Escape' });
    expect(menu()).toBeNull();
    expect(open).toHaveFocus();
    fireEvent.keyDown(open, { key: 'ContextMenu' });
    expect(menu()).toBeInTheDocument();
  });

  it("marks Escape as handled, so the panel's Escape doesn't also fire", () => {
    const { open } = setup();
    fireEvent.contextMenu(open);
    const seen = vi.fn();
    const listener = (e: KeyboardEvent) => seen(e.defaultPrevented);
    document.addEventListener('keydown', listener);
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0]!, { key: 'Escape' });
    document.removeEventListener('keydown', listener);
    expect(menu()).toBeNull();
    // stopPropagation keeps it from reaching the document at all; if it did, it was handled.
    expect(seen.mock.calls.every(([prevented]) => prevented)).toBe(true);
  });

  it('closes on a click outside and on a scroll', () => {
    const { open } = setup();
    fireEvent.contextMenu(open);
    fireEvent.mouseDown(document.body);
    expect(menu()).toBeNull();
    fireEvent.contextMenu(open);
    fireEvent.scroll(window);
    expect(menu()).toBeNull();
  });

  it('opens on a 500ms touch long-press, without opening the card', () => {
    vi.useFakeTimers();
    const { open, onOpen } = setup();
    fireEvent.pointerDown(open, { pointerType: 'touch', clientX: 50, clientY: 50 });
    act(() => vi.advanceTimersByTime(499));
    expect(menu()).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(menu()).toBeInTheDocument();
    fireEvent.pointerUp(open, { pointerType: 'touch' });
    fireEvent.click(open);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('cancels the long-press on a move of more than 8px, or a mouse', () => {
    vi.useFakeTimers();
    const { open, onOpen } = setup();
    fireEvent.pointerDown(open, { pointerType: 'touch', clientX: 50, clientY: 50 });
    fireEvent.pointerMove(open, { pointerType: 'touch', clientX: 55, clientY: 55 });
    fireEvent.pointerMove(open, { pointerType: 'touch', clientX: 60, clientY: 50 });
    act(() => vi.advanceTimersByTime(600));
    expect(menu()).toBeNull();
    fireEvent.pointerDown(open, { pointerType: 'mouse', clientX: 50, clientY: 50 });
    act(() => vi.advanceTimersByTime(600));
    expect(menu()).toBeNull();
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalled();
  });
});

describe('card menu invite item', () => {
  const actions = (): CardMenuActions => ({
    openPerson: vi.fn(),
    focusPerson: vi.fn(),
    addRelative: vi.fn(),
    howRelated: vi.fn(),
    invitePerson: vi.fn(),
  });

  it('is last, names the person, and opens their invite', () => {
    const a = actions();
    const items = cardMenuItems(robert, a, 'new');
    const last = items.at(-1)!;
    expect(last.label).toBe('Invite Robert…');
    expect(last.separated).toBe(true);
    last.onSelect();
    expect(a.invitePerson).toHaveBeenCalledWith('robert');
  });

  it('says when an invite is already open', () => {
    expect(cardMenuItems(robert, actions(), 'pending').at(-1)!.label).toBe(
      'Invite pending for Robert…',
    );
  });

  it('is left out without an invite state or an invite action', () => {
    const labels = (items: { label: string }[]) => items.map((i) => i.label);
    expect(labels(cardMenuItems(robert, actions()))).not.toContain('Invite Robert…');
    const noInvite = { ...actions(), invitePerson: undefined };
    expect(labels(cardMenuItems(robert, noInvite, 'new'))).not.toContain('Invite Robert…');
  });
});
