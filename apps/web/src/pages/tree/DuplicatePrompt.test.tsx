import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakePerson } from '../../test/fake-trees';
import { DuplicatePrompt } from './DuplicatePrompt';

describe('DuplicatePrompt', () => {
  it('asks per match and offers one "No"', () => {
    const ada = fakePerson();
    const bob = fakePerson({ givenName: 'Bob', surname: 'Hale', birthYear: null, deathYear: null });
    const onUse = vi.fn();
    const onCreateNew = vi.fn();
    render(
      <DuplicatePrompt
        matches={[ada, bob]}
        pending={false}
        onUse={onUse}
        onCreateNew={onCreateNew}
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'Is this someone already in the tree?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Is this the existing person Ada Lovelace \(1815–1852\)\?/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, use Ada Lovelace' }));
    expect(onUse).toHaveBeenCalledWith(ada);
    fireEvent.click(screen.getByRole('button', { name: 'No, add a new person' }));
    expect(onCreateNew).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button', { name: /^Yes, use/ })).toHaveLength(2);
  });
});
