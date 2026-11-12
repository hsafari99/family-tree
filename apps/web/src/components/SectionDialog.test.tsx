import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
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
      <form>
        <label>
          Place <input defaultValue="York" />
        </label>
        <label>
          Kind
          <select defaultValue="b">
            <option value="a">A</option>
            <option value="b">B</option>
          </select>
        </label>
        <label>
          Sure <input type="checkbox" />
        </label>
      </form>
    </SectionDialog>,
  );
  const dialog = screen.getByRole('dialog', { hidden: true });
  dialog.getBoundingClientRect = () => ({ ...BOX, toJSON: () => BOX }) as DOMRect;
  return { onClose, dialog };
}

describe('SectionDialog', () => {
  it('closes on a click on the backdrop', () => {
    const { onClose, dialog } = setup();
    fireEvent.pointerDown(dialog, { clientX: 20, clientY: 20 });
    fireEvent.click(dialog, { clientX: 20, clientY: 20 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  const clickOutside = (dialog: HTMLElement) => {
    fireEvent.pointerDown(dialog, { clientX: 20, clientY: 20 });
    fireEvent.click(dialog, { clientX: 20, clientY: 20 });
  };

  it('stays open on a backdrop click while a field holds unsaved input', () => {
    const { onClose, dialog } = setup();
    const place = screen.getByLabelText('Place');
    fireEvent.change(place, { target: { value: 'Leeds' } });
    clickOutside(dialog);
    expect(onClose).not.toHaveBeenCalled();
    // Put back as it was, it is no longer a draft.
    fireEvent.change(place, { target: { value: 'York' } });
    clickOutside(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('counts a changed select or checkbox as unsaved input, and the X still closes', () => {
    const { onClose, dialog } = setup();
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'a' } });
    clickOutside(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'b' } });
    fireEvent.click(screen.getByLabelText('Sure'));
    clickOutside(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('notes a form that appears later before it is typed in', async () => {
    const onClose = vi.fn();
    function Later() {
      const [editing, setEditing] = useState(false);
      return editing ? (
        <form>
          <input aria-label="Name" defaultValue="Ann" />
        </form>
      ) : (
        <button type="button" onClick={() => setEditing(true)}>
          Edit
        </button>
      );
    }
    render(
      <SectionDialog title="Details — Ann" onClose={onClose}>
        <Later />
      </SectionDialog>,
    );
    const dialog = screen.getByRole('dialog', { hidden: true });
    dialog.getBoundingClientRect = () => ({ ...BOX, toJSON: () => BOX }) as DOMRect;
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await act(async () => {});
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Anna' } });
    clickOutside(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores a control outside any form (it acts at once), but not a chosen file or a draft', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <SectionDialog title="Members" onClose={onClose}>
        <select aria-label="Role" defaultValue="viewer">
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
        </select>
        <input aria-label="Photo" type="file" />
      </SectionDialog>,
    );
    const dialog = screen.getByRole('dialog', { hidden: true });
    dialog.getBoundingClientRect = () => ({ ...BOX, toJSON: () => BOX }) as DOMRect;
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'editor' } });
    clickOutside(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
    const photo = screen.getByLabelText('Photo');
    Object.defineProperty(photo, 'value', { value: 'C:\\fakepath\\a.png', configurable: true });
    clickOutside(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(
      <SectionDialog title="Members" onClose={onClose}>
        <div data-unsaved="">A photo being cropped</div>
      </SectionDialog>,
    );
    clickOutside(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open for a click inside it', () => {
    const { onClose, dialog } = setup();
    const body = screen.getByText('Body text');
    fireEvent.pointerDown(body, { clientX: 200, clientY: 200 });
    fireEvent.click(body, { clientX: 200, clientY: 200 });
    // A click on the dialog's own box (its edge), not the backdrop.
    fireEvent.pointerDown(dialog, { clientX: 100, clientY: 250 });
    fireEvent.click(dialog, { clientX: 100, clientY: 250 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays open when a press starts inside and is released outside', () => {
    const { onClose, dialog } = setup();
    fireEvent.pointerDown(screen.getByText('Body text'), { clientX: 200, clientY: 200 });
    fireEvent.click(dialog, { clientX: 20, clientY: 20 });
    expect(onClose).not.toHaveBeenCalled();
  });
});
