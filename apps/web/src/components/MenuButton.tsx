import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

const ITEMS = '[role="menuitem"]:not(:disabled)';

/**
 * A "⋯" menu (the WAI-ARIA menu button pattern) for a row's secondary actions (brief #7, #12).
 * Arrow keys, Home and End move between items; Escape closes and refocuses the trigger; Tab and
 * an outside click close it. Choosing an item closes the menu before running it.
 */
export function MenuButton({
  label,
  items,
  text = '⋯',
  className = 'secondary compact',
}: {
  /** The accessible name of the trigger and the menu. */
  label: string;
  items: MenuItem[];
  /** The visible trigger text. */
  text?: string;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);

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
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
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
