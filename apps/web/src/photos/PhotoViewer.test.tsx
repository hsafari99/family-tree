import type { Photo } from '@family-tree/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PhotoViewer } from './PhotoViewer';

const photo = (n: number, isPrimary = false): Photo => ({
  id: crypto.randomUUID(),
  width: 800,
  height: 600,
  bytes: 1000,
  isPrimary,
  createdAt: '2026-11-17T00:00:00.000Z',
  uploadedByName: 'Ada',
  thumbUrl: `https://photos.test/thumb-${n}.webp`,
  fullUrl: `https://photos.test/full-${n}.webp`,
});
const photos = [photo(1, true), photo(2), photo(3)];

function open(start = 0) {
  const onClose = vi.fn();
  render(<PhotoViewer photos={photos} start={start} name="Ada King" onClose={onClose} />);
  const dialog = screen.getByRole('dialog', { name: 'Photos of Ada King' });
  const shown = () => screen.getByRole('img').getAttribute('src');
  return { onClose, dialog, shown };
}

describe('PhotoViewer', () => {
  it('opens on the photo clicked and moves with Previous and Next, stopping at the ends', () => {
    const { shown } = open(1);
    expect(shown()).toBe(photos[1]!.fullUrl);
    expect(screen.getByText('2 of 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }));
    expect(shown()).toBe(photos[2]!.fullUrl);
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next photo' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Previous photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous photo' }));
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous photo' })).toBeDisabled();
    expect(screen.getByRole('img')).toHaveAccessibleName('Photo 1 of 3 of Ada King, main photo');
  });

  it('turns the page with the arrow keys', () => {
    const { dialog } = open(0);
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('turns the page with a swipe, and ignores a short drag', () => {
    open(0);
    const stage = screen.getByRole('img').parentElement!;
    fireEvent.pointerDown(stage, { clientX: 300 });
    fireEvent.pointerUp(stage, { clientX: 280 });
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    fireEvent.pointerDown(stage, { clientX: 300 });
    fireEvent.pointerUp(stage, { clientX: 150 });
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    fireEvent.pointerDown(stage, { clientX: 100 });
    fireEvent.pointerUp(stage, { clientX: 300 });
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('closes with the X and offers the full-size file', () => {
    const { onClose } = open(0);
    expect(screen.getByRole('link', { name: 'Open full size' })).toHaveAttribute(
      'href',
      photos[0]!.fullUrl,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close photos' }));
    expect(onClose).toHaveBeenCalled();
  });
});
