import type { HealthResponse } from '@family-tree/shared';
import { useEffect, useState } from 'react';
import { getHealth } from './api/client';

type State =
  { kind: 'loading' } | { kind: 'ready'; health: HealthResponse } | { kind: 'unreachable' };

const LABELS = { db: 'Database', storage: 'Storage' } as const;

export function HealthStatus({ load = getHealth }: { load?: () => Promise<HealthResponse> }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    load().then(
      (health) => active && setState({ kind: 'ready', health }),
      () => active && setState({ kind: 'unreachable' }),
    );
    return () => {
      active = false;
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
