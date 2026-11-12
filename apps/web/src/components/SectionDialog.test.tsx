import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SectionDialog } from './SectionDialog';

// The dialog's box, as the browser would lay it out (jsdom has no layout).
const BOX = {
  left: 100,
  top: 100,
  right: 500,
  bottom: 400,
  width: 400,
  height: 300,
  x: 100,
  y: 100,
};

function setup() {
  const onClose = vi.fn();
  render(
    <SectionDialog title="Places — Ann" onClose={onClose}>
      <p>Body text</p>
    </SectionDialog>,
  );
  const dialog = screen.getByRole('dialog', { hidden: true });
  dialog.getBoundingClientRect = () => ({ ...BOX, toJSON: () => BOX }) as DOMRect;
  return { onClose, dialog };
}

describe('SectionDialog', () => {
  it('closes on a click on the backdrop', () => {
    const { onClose, dialog } = setup();
    fireEvent.mouseDown(dialog, { clientX: 20, clientY: 20 });
    fireEvent.click(dialog, { clientX: 20, clientY: 20 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open for a click inside it', () => {
    const { onClose, dialog } = setup();
    const body = screen.getByText('Body text');
    fireEvent.mouseDown(body, { clientX: 200, clientY: 200 });
    fireEvent.click(body, { clientX: 200, clientY: 200 });
    // A click on the dialog's own box (its edge), not the backdrop.
    fireEvent.mouseDown(dialog, { clientX: 100, clientY: 250 });
    fireEvent.click(dialog, { clientX: 100, clientY: 250 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays open when a press starts inside and is released outside', () => {
    const { onClose, dialog } = setup();
    fireEvent.mouseDown(screen.getByText('Body text'), { clientX: 200, clientY: 200 });
    fireEvent.click(dialog, { clientX: 20, clientY: 20 });
    expect(onClose).not.toHaveBeenCalled();
  });
});
