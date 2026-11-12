import { type KeyboardEvent, type Ref, type RefObject, useEffect } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

const ITEMS = '[role="menuitem"]:not(:disabled)';

/** Moves focus to item i of the open list (wrapping round). */
export function focusMenuItem(list: HTMLElement | null, i: number) {
  const els = list?.querySelectorAll<HTMLButtonElement>(ITEMS);
  if (!els || els.length === 0) return;
  els[(i + els.length) % els.length]!.focus();
}

/**
 * While a fixed menu is open: a mousedown outside it (and outside `keep`, its trigger) closes it,
 * and so do a scroll, a resize or a wheel outside it (it would drift away from what opened it).
 */
export function useCloseOnOutside(
  open: boolean,
  list: RefObject<HTMLElement | null>,
  close: () => void,
  keep?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) =>
      t instanceof Node && (list.current?.contains(t) || keep?.current?.contains(t));
    const onDown = (e: Event) => {
      if (!inside(e.target)) close();
    };
    const onMove = (e: Event) => {
      if (e.target instanceof Node && list.current?.contains(e.target)) return;
      close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('wheel', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('wheel', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, list, close, keep]);
}

/**
 * The open list of a menu (the WAI-ARIA menu pattern): arrow keys, Home and End move between
 * items; Escape closes it and refocuses what opened it (and is marked handled, so the side panel's
 * own Escape-to-close doesn't fire too); Tab closes it. Choosing an item closes the menu before
 * running it.
 */
export function MenuList({
  id,
  label,
  items,
  listRef,
  onClose,
}: {
  id?: string;
  label: string;
  items: MenuItem[];
  listRef: Ref<HTMLUListElement> & RefObject<HTMLUListElement | null>;
  /** `refocus`: give focus back to what opened the menu. */
  onClose: (refocus: boolean) => void;
}) {
  const onKey = (e: KeyboardEvent) => {
    const list = listRef.current;
    const els = [...(list?.querySelectorAll<HTMLButtonElement>(ITEMS) ?? [])];
    const at = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusMenuItem(list, at + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusMenuItem(list, at < 0 ? -1 : at - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusMenuItem(list, 0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusMenuItem(list, els.length - 1);
    } else if (e.key === 'Escape') {
      // Keep the panel's own Escape-to-close from firing as well.
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
    } else if (e.key === 'Tab') {
      onClose(false);
    }
  };
  return (
    <ul
      id={id}
      role="menu"
      aria-label={label}
      ref={listRef}
      className="menu-list"
      onKeyDown={onKey}
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
              onClose(true);
              it.onSelect();
            }}
          >
            {it.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
