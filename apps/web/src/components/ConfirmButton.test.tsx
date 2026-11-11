import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmButton } from './ConfirmButton';

function setup() {
  const onConfirm = vi.fn();
  render(<ConfirmButton label="Delete tree" confirmLabel="Yes, delete it" onConfirm={onConfirm} />);
  return onConfirm;
}

describe('ConfirmButton', () => {
  it('does not confirm on the first click, and moves focus to the confirm button', () => {
    const onConfirm = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete tree' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Yes, delete it' })).toHaveFocus();
  });

  it('confirms once on the second click', () => {
    const onConfirm = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete tree' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete it' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('restores the label on Cancel', () => {
    const onConfirm = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete tree' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Delete tree' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Yes, delete it' })).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancels on Escape', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete tree' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Yes, delete it' }), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Delete tree' })).toBeInTheDocument();
  });
});

describe('ConfirmButton startAsking', () => {
  it('starts in the confirm step with focus on it, and Cancel calls onCancel', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmButton
        startAsking
        label="Remove"
        confirmLabel="Yes, remove"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole('button', { name: 'Yes, remove' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Escape also calls onCancel', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmButton
        startAsking
        label="Remove"
        confirmLabel="Yes, remove"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Yes, remove' }), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('compact adds the compact class', () => {
    render(<ConfirmButton compact label="Remove" confirmLabel="Yes" onConfirm={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveClass('compact');
  });
});
