import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders its title, body and action, with a decorative illustration', () => {
    const { container } = render(
      <EmptyState
        title="The Trash is empty."
        body="Deleted people show up here."
        action={<a href="/x">Back to the tree</a>}
      />,
    );
    expect(screen.getByText('The Trash is empty.')).toBeInTheDocument();
    expect(screen.getByText('Deleted people show up here.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the tree' })).toBeInTheDocument();
    expect(container.querySelector('.empty-state-art svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('takes its own icon, and leaves out what it is not given', () => {
    const { container } = render(<EmptyState title="Nobody yet" icon={<svg data-testid="i" />} />);
    expect(screen.getByTestId('i')).toBeInTheDocument();
    expect(container.querySelector('.empty-state-body')).toBeNull();
    expect(container.querySelector('.empty-state-action')).toBeNull();
  });
});
