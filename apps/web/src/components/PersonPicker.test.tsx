import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakePerson } from '../test/fake-trees';
import { PersonPicker, placeMatches } from './PersonPicker';

const rect = (top: number, left: number, width: number, height = 36) =>
  ({ top, left, width, height, bottom: top + height, right: left + width }) as DOMRect;

describe('placeMatches', () => {
  it('goes under the input when there is room, fixed and as wide as the input', () => {
    expect(placeMatches(rect(100, 50, 300), 1280, 720)).toEqual({
      position: 'fixed',
      left: 50,
      width: 300,
      top: 140,
      maxHeight: 320,
    });
  });

  it('goes above the input near the bottom of the window', () => {
    const p = placeMatches(rect(600, 50, 300), 1280, 720);
    expect(p).toMatchObject({ position: 'fixed', bottom: 124, maxHeight: 320 });
    expect(p).not.toHaveProperty('top');
  });

  it('is at least 240px wide and stays inside the window', () => {
    expect(placeMatches(rect(100, 300, 120), 390, 844)).toMatchObject({ left: 142, width: 240 });
  });
});

describe('PersonPicker', () => {
  const persons = [
    fakePerson({ id: 'a', givenName: 'Ada', surname: 'Hale' }),
    fakePerson({ id: 'b', givenName: 'Adam', surname: 'Hale' }),
  ];

  it('overlays its matches (fixed, from the input) so the content below does not move', () => {
    const onChange = vi.fn();
    render(
      <div>
        <PersonPicker label="To" persons={persons} value={null} onChange={onChange} />
        <p>Below</p>
      </div>,
    );
    const input = screen.getByLabelText('To');
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(rect(100, 20, 300));
    fireEvent.change(input, { target: { value: 'Ad' } });
    const list = screen.getByRole('list');
    expect(list).toHaveStyle({ position: 'fixed', top: '140px', left: '20px', width: '300px' });
    // Out of the flow: the list is not the input's next sibling block that pushes "Below" down.
    expect(getComputedStyle(list).position).toBe('fixed');
    fireEvent.click(screen.getByRole('button', { name: /^Adam Hale/ }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
