import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HealthStatus } from './HealthStatus';

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
});
