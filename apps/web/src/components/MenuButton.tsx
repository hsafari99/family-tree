import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { MoreIcon } from './icons';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

const ITEMS = '[role="menuitem"]:not(:disabled)';
const GAP = 4;
const EDGE = 8;

type Box = { top: number; bottom: number; left: number; right: number };

/**
 * Where to draw the open menu, in viewport coordinates. The list is `position: fixed` so no
 * scrolling ancestor (a section dialog's body, the side panel) can clip it. It stays inside
 * `bounds` (the enclosing dialog, else the viewport) where it can: under the trigger's left edge
 * when it fits, else lined up with its right edge, and upward when there is no room below.
 */
export function placeMenu(
  t: Box,
  m: { width: number; height: number },
  bounds: Box,
  vw: number,
  vh: number,
): { top: number; left: number } {
  const lo = Math.max(EDGE, bounds.left + EDGE);
  const hi = Math.min(vw - EDGE, bounds.right - EDGE);
  let left = t.left + m.width <= hi ? t.left : t.right - m.width;
  left = Math.max(lo, Math.min(left, hi - m.width));
  left = Math.max(EDGE, Math.min(left, vw - m.width - EDGE));
  let top = t.bottom + GAP;
  if (top + m.height > vh - EDGE && t.top - GAP - m.height >= EDGE) top = t.top - GAP - m.height;
  return { top, left };
}

/**
 * A "⋯" menu (the WAI-ARIA menu button pattern) for a row's secondary actions (brief #7, #12).
 * Arrow keys, Home and End move between items; Escape closes and refocuses the trigger; Tab and
 * an outside click close it. Choosing an item closes the menu before running it.
 */
export function MenuButton({
  label,
  items,
  text = <MoreIcon />,
  className = 'secondary compact',
}: {
  /** The accessible name of the trigger and the menu. */
  label: string;
  items: MenuItem[];
  /** The visible trigger content (hidden from assistive tech when it isn't the label). */
  text?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  // Place the list once it is in the DOM, before paint (and before the focus effect below), so it
  // never flashes in the wrong place and is focusable straight away.
  useLayoutEffect(() => {
    const list = menu.current;
    const t = trigger.current?.getBoundingClientRect();
    if (!open || !list || !t) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dialog = trigger.current?.closest('dialog')?.getBoundingClientRect();
    const bounds = dialog ?? { top: 0, bottom: vh, left: 0, right: vw };
    const { top, left } = placeMenu(t, list.getBoundingClientRect(), bounds, vw, vh);
    list.style.top = `${top}px`;
    list.style.left = `${left}px`;
  }, [open]);

  const focusItem = (i: number) => {
    const els = menu.current?.querySelectorAll<HTMLButtonElement>(ITEMS);
    if (!els || els.length === 0) return;
    els[(i + els.length) % els.length]!.focus();
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    focusItem(0);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    // A fixed menu would drift away from its trigger on scroll or resize, so close it instead.
    const onMove = (e: Event) => {
      if (e.target instanceof Node && menu.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  const onMenuKey = (e: KeyboardEvent) => {
    const els = [...(menu.current?.querySelectorAll<HTMLButtonElement>(ITEMS) ?? [])];
    const at = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(at + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(at < 0 ? -1 : at - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(els.length - 1);
    } else if (e.key === 'Escape') {
      // Keep the panel's own Escape-to-close from firing as well.
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const visible = text !== label;
  return (
    <span className="menu">
      <button
        ref={trigger}
        type="button"
        className={`${className} menu-trigger`}
        aria-label={visible ? label : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {visible ? <span aria-hidden="true">{text}</span> : text}
      </button>
      {open && (
        <ul
          id={id}
          role="menu"
          aria-label={label}
          ref={menu}
          className="menu-list"
          onKeyDown={onMenuKey}
        >
          {items.map((it) => (
            <li key={it.label} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={it.disabled}
                className={it.danger ? 'menu-item danger-text' : 'menu-item'}
                onClick={() => {
                  close(true);
                  it.onSelect();
                }}
              >
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
