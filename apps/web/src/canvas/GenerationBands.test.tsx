import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GutterLabels } from './GenerationBands';

const bands = [
  { label: 'Parents’ generation', top: -40, bottom: 100, cardsTop: 0 },
  { label: 'Your generation', top: 100, bottom: 300, cardsTop: 128 },
];
const labels = () => [...document.querySelectorAll('.generation-label')].map((e) => e.textContent);

describe('GutterLabels', () => {
  it('names every band when zoomed out, each centred in its band', () => {
    // At 0.3 the strip above a row is under 20px: the names stay anyway (they're beside the pane).
    render(<GutterLabels bands={bands} ty={12} zoom={0.3} />);
    expect(labels()).toEqual(['Parents’ generation', 'Your generation']);
    const band = document.querySelectorAll<HTMLElement>('.generation-gutter-band')[1]!;
    expect(band.style.top).toBe(`${100 * 0.3 + 12}px`);
    expect(band.style.height).toBe(`${200 * 0.3}px`);
  });
  it('keeps the column but names nothing at the dot zoom', () => {
    render(<GutterLabels bands={bands} ty={0} zoom={0.1} />);
    expect(document.querySelector('.generation-gutter')).not.toBeNull();
    expect(labels()).toEqual([]);
  });
});
