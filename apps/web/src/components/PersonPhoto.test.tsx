import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonPhoto, PhotoRefreshContext, useThrottled } from './PersonPhoto';

const ada = { givenName: 'Ada', middleName: null, surname: 'Lovelace' };

afterEach(() => vi.useRealTimers());

describe('PersonPhoto', () => {
  it('shows the initials, hidden from assistive tech, without a URL', () => {
    render(<PersonPhoto url={null} person={ada} className="x" />);
    const el = screen.getByText('AL');
    expect(el).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders an image with an empty alt', () => {
    const { container } = render(<PersonPhoto url="https://p.test/a" person={ada} className="x" />);
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('src', 'https://p.test/a');
    expect(img).toHaveAttribute('alt', '');
  });

  it('falls back to the initials on error, asks for a refresh once, and retries on a new URL', () => {
    const refresh = vi.fn();
    const ui = (url: string) => (
      <PhotoRefreshContext.Provider value={refresh}>
        <PersonPhoto url={url} person={ada} className="x" />
      </PhotoRefreshContext.Provider>
    );
    const { container, rerender } = render(ui('https://p.test/a'));
    fireEvent.error(container.querySelector('img')!);
    expect(screen.getByText('AL')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender(ui('https://p.test/b'));
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://p.test/b');
  });
});

describe('useThrottled', () => {
  it('runs at most once a minute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const fn = vi.fn();
    const { result } = renderHook(() => useThrottled(fn));
    act(() => {
      result.current();
      result.current();
      result.current();
    });
    expect(fn).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-01-01T00:01:01Z'));
    act(() => result.current());
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
