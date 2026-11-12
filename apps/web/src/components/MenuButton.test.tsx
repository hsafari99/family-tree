import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MenuButton, placeMenu } from './MenuButton';

describe('MenuButton', () => {
  it('opens with the keyboard and focuses the first item', () => {
    render(
      <MenuButton
        label="More actions for Leo"
        items={[
          { label: 'Edit', onSelect: vi.fn() },
          { label: 'Remove', onSelect: vi.fn() },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'More actions for Leo' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Home' });
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('runs the item and closes', () => {
    const onSelect = vi.fn();
    render(<MenuButton label="More" items={[{ label: 'Edit', onSelect }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on an outside click', () => {
    render(<MenuButton label="More" items={[{ label: 'Edit', onSelect: vi.fn() }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Tab', () => {
    render(<MenuButton label="More" items={[{ label: 'Edit', onSelect: vi.fn() }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps Escape from reaching outer handlers', () => {
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <MenuButton label="More" items={[{ label: 'Edit', onSelect: vi.fn() }]} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(outer).not.toHaveBeenCalled();
  });

  it('skips disabled items and can show visible text', () => {
    render(
      <MenuButton
        label="Add relative"
        text="Add relative"
        items={[
          { label: 'Parent', onSelect: vi.fn(), disabled: true },
          { label: 'Child', onSelect: vi.fn() },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add relative' }));
    expect(screen.getByRole('menuitem', { name: 'Child' })).toHaveFocus();
    expect(screen.getByRole('menuitem', { name: 'Parent' })).toBeDisabled();
  });
});

describe('placeMenu', () => {
  const m = { width: 200, height: 150 };
  const r = (left: number, top: number) => ({ left, right: left + 100, top, bottom: top + 30 });
  const screen = (vw: number, vh = 720) => ({ top: 0, left: 0, right: vw, bottom: vh });

  it('opens under the trigger, from its left edge, when that fits', () => {
    expect(placeMenu(r(300, 100), m, screen(1280), 1280, 720)).toEqual({ top: 134, left: 300 });
  });

  it('lines up with the right edge when it would run past the right side', () => {
    expect(placeMenu(r(1150, 100), m, screen(1280), 1280, 720).left).toBe(1050);
  });

  it('stays inside an enclosing dialog', () => {
    const dialog = { top: 150, bottom: 570, left: 280, right: 1000 };
    expect(placeMenu(r(300, 500), m, dialog, 1280, 720).left).toBe(300);
    expect(placeMenu(r(880, 200), m, dialog, 1280, 720).left).toBe(780);
  });

  it('stays inside the viewport on a narrow screen', () => {
    expect(placeMenu(r(250, 100), m, screen(390), 390, 720).left).toBe(150);
    expect(placeMenu(r(0, 100), m, screen(150), 150, 720).left).toBe(8);
  });

  it('opens upward when there is no room below', () => {
    expect(placeMenu(r(500, 650), m, screen(1280), 1280, 720).top).toBe(496);
  });
});
