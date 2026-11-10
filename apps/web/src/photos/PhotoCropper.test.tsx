import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoCropper } from './PhotoCropper';

const file = () => new File(['x'], 'a.png', { type: 'image/png' });

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:x');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** Renders at a given on-screen width for the 400x200 photo (jsdom has no layout). */
function setup(renderedWidth: number | null) {
  render(<PhotoCropper file={file()} busy={false} onDone={() => {}} onCancel={() => {}} />);
  const img = screen.getByAltText('The chosen photo');
  Object.defineProperty(img, 'naturalWidth', { value: 400, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: 200, configurable: true });
  const view = document.querySelector<HTMLElement>('.crop-view')!;
  if (renderedWidth !== null) {
    view.getBoundingClientRect = () =>
      ({ width: renderedWidth, height: renderedWidth / 2 }) as DOMRect;
  }
  fireEvent.load(img);
  return { view, area: screen.getByRole('group', { name: /Crop area/ }) };
}

describe('PhotoCropper geometry', () => {
  it('positions the crop box in percentages, so a narrow panel keeps its proportions', () => {
    const { view, area } = setup(160);
    // 400x200 photo, centred 200px square: x=100,y=0,size=200.
    expect(area.style.left).toBe('25%');
    expect(area.style.top).toBe('0%');
    expect(area.style.width).toBe('50%');
    expect(area.style.height).toBe('100%');
    expect(view.style.aspectRatio.replace(/\s/g, '')).toBe('400/200');
  });

  it('turns a drag into photo pixels using the measured width', () => {
    const { area } = setup(160); // 0.4 screen px per photo px
    fireEvent.pointerDown(area, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(area, { pointerId: 1, clientX: -20, clientY: 0 });
    // -20 screen px = -50 photo px: x 100 -> 50 = 12.5%.
    expect(area.style.left).toBe('12.5%');
  });

  it('falls back to the fixed scale when nothing is measured', () => {
    const { area } = setup(null); // 320 / 400 = 0.8 screen px per photo px
    fireEvent.pointerDown(area, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(area, { pointerId: 1, clientX: -40, clientY: 0 });
    expect(area.style.left).toBe('12.5%');
  });

  it.each(['pointerUp', 'pointerCancel', 'lostPointerCapture'] as const)(
    'ends the drag on %s',
    (end) => {
      const { area } = setup(160);
      fireEvent.pointerDown(area, { pointerId: 1, clientX: 0, clientY: 0 });
      fireEvent[end](area, { pointerId: 1 });
      fireEvent.pointerMove(area, { pointerId: 1, clientX: -20, clientY: 0 });
      expect(area.style.left).toBe('25%');
    },
  );
});
