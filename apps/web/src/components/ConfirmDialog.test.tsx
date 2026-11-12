import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

function Harness({ onConfirm = () => {} }: { onConfirm?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Delete thing
      </button>
      <ConfirmDialog
        open={open}
        title="Delete the thing?"
        confirmLabel="Delete"
        danger
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          onConfirm();
        }}
      >
        <p>This can’t be undone.</p>
      </ConfirmDialog>
    </>
  );
}

const opener = () => screen.getByRole('button', { name: 'Delete thing' });
function open() {
  opener().focus();
  fireEvent.click(opener());
  return screen.getByRole('dialog', { name: 'Delete the thing?' });
}

describe('ConfirmDialog', () => {
  it('cancels on a press and release on the backdrop, not on a drag that ends there', () => {
    render(<Harness />);
    const dialog = open();
    const box = {
      left: 100,
      top: 100,
      right: 500,
      bottom: 400,
      width: 400,
      height: 300,
      x: 100,
      y: 100,
    };
    dialog.getBoundingClientRect = () => ({ ...box, toJSON: () => box }) as DOMRect;
    fireEvent.pointerDown(screen.getByText('This can’t be undone.'), {
      clientX: 200,
      clientY: 200,
    });
    fireEvent.click(dialog, { clientX: 20, clientY: 20 });
    expect(screen.getByRole('dialog', { name: 'Delete the thing?' })).toBeInTheDocument();
    fireEvent.pointerDown(dialog, { clientX: 20, clientY: 20 });
    fireEvent.click(dialog, { clientX: 20, clientY: 20 });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it('is closed until asked, then a named, described modal with focus on Cancel', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const dialog = open();
    expect(dialog).toHaveAccessibleDescription('This can’t be undone.');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('danger');
  });

  it('Cancel closes it and returns focus to the opener', () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener()).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Esc (the dialog’s cancel event) closes it the same way', () => {
    render(<Harness />);
    const dialog = open();
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener()).toHaveFocus();
  });

  it('confirming calls onConfirm and closes', () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
