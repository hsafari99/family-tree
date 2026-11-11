import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar, nameInitials } from './Avatar';

describe('Avatar', () => {
  it('shows the picture with the name as its alt text, at the size asked for', () => {
    render(<Avatar name="Ada Lovelace" url="https://s3.test/a.webp" size={64} />);
    const img = screen.getByRole('img', { name: 'Ada Lovelace' });
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', 'https://s3.test/a.webp');
    expect(img).toHaveStyle({ width: '64px', height: '64px' });
  });

  it('without a picture shows the initials, still named by the user', () => {
    render(<Avatar name="Ada Lovelace" url={null} />);
    const fallback = screen.getByRole('img', { name: 'Ada Lovelace' });
    expect(fallback.tagName).toBe('SPAN');
    expect(fallback).toHaveClass('avatar-default');
    expect(fallback).toHaveTextContent('AL');
    expect(fallback).toHaveStyle({ width: '40px' });
  });

  it('fluid: fills its container up to the size, staying square', () => {
    render(<Avatar name="Ada" url={null} size={200} fluid />);
    expect(screen.getByRole('img', { name: 'Ada' })).toHaveStyle({
      width: '100%',
      maxWidth: '200px',
    });
  });

  it('falls back to the initials when the picture fails to load', () => {
    render(<Avatar name="Ada" url="https://s3.test/expired.webp" />);
    fireEvent.error(screen.getByRole('img', { name: 'Ada' }));
    expect(screen.getByRole('img', { name: 'Ada' })).toHaveTextContent('A');
  });

  it.each([
    ['Ada Lovelace', 'AL'],
    ['  ada   king  lovelace ', 'AL'],
    ['Ada', 'A'],
    ['élodie durand', 'ÉD'],
    ['', '?'],
  ])('initials of %j are %s', (name, expected) => {
    expect(nameInitials(name)).toBe(expected);
  });
});
