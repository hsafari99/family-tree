import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './Toast';

function Trigger({ message = 'Parent added', tone }: { message?: string; tone?: 'error' }) {
  const { show } = useToast();
  return (
    <button type="button" onClick={() => show(message, tone)}>
      Go
    </button>
  );
}

const setup = (tone?: 'error') =>
  render(
    <ToastProvider>
      <Trigger tone={tone} />
    </ToastProvider>,
  );

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the message in a polite live region', () => {
    setup();
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(region).toHaveTextContent('Parent added');
  });

  it('hides itself after 4 seconds', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    act(() => vi.advanceTimersByTime(3900));
    expect(screen.getByText('Parent added')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText('Parent added')).toBeNull();
  });

  it('waits while it has focus or the pointer, then hides', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    act(() => dismiss.focus());
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText('Parent added')).toBeInTheDocument();
    act(() => dismiss.blur());
    fireEvent.mouseEnter(screen.getByText('Parent added').closest('.toast')!);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText('Parent added')).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByText('Parent added').closest('.toast')!);
    act(() => vi.advanceTimersByTime(4100));
    expect(screen.queryByText('Parent added')).toBeNull();
  });

  it('closes with Dismiss', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Parent added')).toBeNull();
  });

  it('marks an error toast', () => {
    setup('error');
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByText('Parent added').closest('.toast')).toHaveClass('toast-error');
  });

  it('does nothing without a provider', () => {
    render(<Trigger />);
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.queryByText('Parent added')).toBeNull();
  });
});
