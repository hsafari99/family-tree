import type { HealthResponse } from '@family-tree/shared';
import { useEffect, useState } from 'react';
import { getHealth } from './api/client';

type State =
  { kind: 'loading' } | { kind: 'ready'; health: HealthResponse } | { kind: 'unreachable' };

const LABELS = { db: 'Database', storage: 'Storage' } as const;

export const HEALTH_TIMEOUT_MS = 5000;

export function HealthStatus({
  load = getHealth,
}: {
  load?: (signal: AbortSignal) => Promise<HealthResponse>;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    // Cleared on unmount, so this only fires while mounted. It sets the state itself
    // rather than relying on `load` to reject when the signal aborts.
    const timeout = setTimeout(() => {
      controller.abort(new DOMException('Health check timed out', 'TimeoutError'));
      setState({ kind: 'unreachable' });
    }, HEALTH_TIMEOUT_MS);

    load(controller.signal)
      .then(
        (health) => {
          if (!controller.signal.aborted) setState({ kind: 'ready', health });
        },
        () => {
          if (!controller.signal.aborted) setState({ kind: 'unreachable' });
        },
      )
      .finally(() => clearTimeout(timeout));

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [load]);

  if (state.kind === 'loading') return <p className="status">Checking services…</p>;
  if (state.kind === 'unreachable')
    return <p className="status status--bad">Cannot reach the API</p>;

  const { health } = state;
  return (
    <section className={`status ${health.status === 'ok' ? 'status--ok' : 'status--bad'}`}>
      <p>{health.status === 'ok' ? 'All systems operational' : 'Some services are down'}</p>
      <ul>
        {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((key) => (
          <li key={key}>{`${LABELS[key]}: ${health.checks[key]}`}</li>
        ))}
      </ul>
    </section>
  );
}
