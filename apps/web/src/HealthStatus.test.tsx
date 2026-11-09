import type { HealthResponse } from '@family-tree/shared';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEALTH_TIMEOUT_MS, HealthStatus } from './HealthStatus';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('HealthStatus', () => {
  it('shows a loading state first', () => {
    render(<HealthStatus load={() => new Promise(() => {})} />);
    expect(screen.getByText(/checking/i)).toBeInTheDocument();
  });

  it('shows all systems operational when healthy', async () => {
    render(
      <HealthStatus load={async () => ({ status: 'ok', checks: { db: 'ok', storage: 'ok' } })} />,
    );
    expect(await screen.findByText('All systems operational')).toBeInTheDocument();
  });

  it('lists each check when degraded', async () => {
    render(
      <HealthStatus
        load={async () => ({ status: 'degraded', checks: { db: 'ok', storage: 'error' } })}
      />,
    );
    expect(await screen.findByText('Some services are down')).toBeInTheDocument();
    expect(screen.getByText('Storage: error')).toBeInTheDocument();
    expect(screen.getByText('Database: ok')).toBeInTheDocument();
  });

  it('says when the API is unreachable', async () => {
    render(
      <HealthStatus
        load={async () => {
          throw new Error('network');
        }}
      />,
    );
    expect(await screen.findByText('Cannot reach the API')).toBeInTheDocument();
  });

  it('aborts the request and ignores a late result after unmount', async () => {
    let resolve!: (h: HealthResponse) => void;
    let signal!: AbortSignal;
    const consoleError = vi.spyOn(console, 'error');
    const { unmount } = render(
      <HealthStatus
        load={(s) => {
          signal = s;
          return new Promise((r) => (resolve = r));
        }}
      />,
    );
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ status: 'ok', checks: { db: 'ok', storage: 'ok' } }));
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('gives up after the timeout when the API never answers', async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    render(
      <HealthStatus
        load={(s) => {
          signal = s;
          return new Promise(() => {});
        }}
      />,
    );
    expect(screen.getByText(/checking/i)).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS);
    });
    expect(screen.getByText('Cannot reach the API')).toBeInTheDocument();
    expect(signal.aborted).toBe(true);
  });
});
