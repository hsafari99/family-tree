import type { GraphPerson, RelativeRole } from '@family-tree/shared';
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { placeMenu } from '../components/MenuButton';
import { focusMenuItem, type MenuItem, MenuList, useCloseOnOutside } from '../components/MenuList';

/** What the card menu can do; the page supplies these through the canvas actions. */
export interface CardMenuActions {
  openPerson(personId: string): void;
  /** Focus view on this person. */
  focusPerson(personId: string): void;
  addRelative(personId: string, as: RelativeRole): void;
  /** "How are we related?" with this person as To. */
  howRelated(personId: string): void;
}

const ADD: [RelativeRole, string][] = [
  ['parent', 'Add parent'],
  ['partner', 'Add partner'],
  ['child', 'Add child'],
  ['sibling', 'Add sibling'],
];

export function cardMenuItems(person: GraphPerson, a: CardMenuActions): MenuItem[] {
  const id = person.id;
  return [
    { label: 'Open details', onSelect: () => a.openPerson(id) },
    { label: 'Focus on this person', onSelect: () => a.focusPerson(id) },
    ...(person.canAddRelative
      ? ADD.map(([as, label]) => ({ label, onSelect: () => a.addRelative(id, as) }))
      : []),
    { label: 'How are we related?', onSelect: () => a.howRelated(id) },
  ];
}

type Box = { top: number; bottom: number; left: number; right: number };

const LONG_PRESS_MS = 500;
const MOVE_SLOP = 8;

/**
 * Opening a card's menu (Task 11): a right-click at the pointer, a 500ms touch long-press (a move
 * of more than 8px cancels it), or Shift+F10 / the ContextMenu key on the focused card, under it.
 * `swallowClick` is true once for the click that ends a long-press, so it doesn't open the card.
 */
export function useCardMenu(card: () => HTMLElement | null) {
  const [at, setAt] = useState<Box | null>(null);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const longPressed = useRef(false);
  const cancel = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancel, []);
  const point = (x: number, y: number): Box => ({ top: y, bottom: y, left: x, right: x });
  const underCard = (): Box | null => {
    const r = card()?.getBoundingClientRect();
    return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null;
  };
  // Events from the (portalled) menu bubble through React to the card: ignore those.
  const own = (e: { currentTarget: Element; target: EventTarget }) =>
    e.target instanceof Node && e.currentTarget.contains(e.target);

  const handlers = {
    onContextMenu: (e: MouseEvent) => {
      if (!own(e)) return;
      e.preventDefault();
      // A keyboard-made contextmenu has no pointer position: put the menu under the card.
      setAt(e.clientX === 0 && e.clientY === 0 ? underCard() : point(e.clientX, e.clientY));
    },
    onPointerDown: (e: PointerEvent) => {
      if (!own(e) || e.pointerType !== 'touch') return;
      cancel();
      const { clientX: x, clientY: y } = e;
      press.current = {
        x,
        y,
        timer: setTimeout(() => {
          press.current = null;
          longPressed.current = true;
          setAt(point(x, y));
        }, LONG_PRESS_MS),
      };
    },
    onPointerMove: (e: PointerEvent) => {
      const p = press.current;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_SLOP) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      e.preventDefault();
      setAt(underCard());
    }
  };
  const swallowClick = () => {
    const was = longPressed.current;
    longPressed.current = false;
    return was;
  };
  const close = useCallback(() => setAt(null), []);
  return { at, handlers, onKeyDown, swallowClick, close };
}

/** The open card menu, drawn on the page (outside the canvas's transform) at `at`. */
export function CardMenu({
  label,
  items,
  at,
  onClose,
}: {
  label: string;
  items: MenuItem[];
  at: Box;
  /** `refocus`: give focus back to the card. */
  onClose: (refocus: boolean) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bounds = { top: 0, bottom: vh, left: 0, right: vw };
    const { top, left } = placeMenu(at, el.getBoundingClientRect(), bounds, vw, vh);
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }, [at]);
  useEffect(() => focusMenuItem(list.current, 0), []);
  const dismiss = useCallback(() => onClose(false), [onClose]);
  useCloseOnOutside(true, list, dismiss);
  return createPortal(
    <MenuList label={label} items={items} listRef={list} onClose={onClose} />,
    document.body,
  );
}
