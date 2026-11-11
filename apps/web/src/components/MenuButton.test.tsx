import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MenuButton } from './MenuButton';

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
