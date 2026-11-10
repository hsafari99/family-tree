import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CardDetail } from './canvas-settings';
import { PersonCardView } from './PersonCard';
import { gp } from './test-fixtures';

const robert = gp('robert', 'Robert', 1930, { deathYear: 1998, isLiving: false, hasParents: true });

function view(
  over: Partial<Parameters<typeof PersonCardView>[0]> = {},
  detail: CardDetail = 'full',
) {
  const onOpen = vi.fn();
  const onAdd = vi.fn();
  const utils = render(
    <PersonCardView
      person={robert}
      detail={detail}
      isFocus={false}
      isMe={false}
      onOpen={onOpen}
      onAdd={onAdd}
      {...over}
    />,
  );
  return { onOpen, onAdd, ...utils };
}

describe('PersonCardView', () => {
  it('shows initials, name and years, and opens on click', () => {
    const { onOpen, container } = view();
    expect(screen.getByText('RH')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Robert Hale')).toBeInTheDocument();
    expect(screen.getByText(/† 1930–1998/)).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('is-deceased');
    fireEvent.click(screen.getByRole('button', { name: 'Robert Hale, 1930–1998, deceased' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('has four labelled add buttons', () => {
    const { onAdd } = view();
    for (const w of ['parent', 'sibling', 'partner', 'child']) {
      expect(screen.getByRole('button', { name: `Add a ${w} of Robert Hale` })).toBeEnabled();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Add a child of Robert Hale' }));
    expect(onAdd).toHaveBeenCalledWith('child');
  });

  it('disables sibling when there are no parents', () => {
    view({ person: { ...robert, hasParents: false } });
    const b = screen.getByRole('button', { name: 'Add a sibling of Robert Hale' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', 'Add a parent first');
  });

  it('has no add buttons without permission', () => {
    view({ person: { ...robert, canAddRelative: false } });
    expect(screen.queryByRole('button', { name: /^Add a/ })).toBeNull();
  });

  it('compact: name and years, no initials or add buttons', () => {
    view({}, 'compact');
    expect(screen.queryByText('RH')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Add a/ })).toBeNull();
    expect(screen.getByText('Robert Hale')).toBeInTheDocument();
    expect(screen.getByText(/1930–1998/)).toBeInTheDocument();
  });

  it('dot: one named button and no visible text', () => {
    const { container } = view({}, 'dot');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Robert Hale, 1930–1998, deceased' }),
    ).toBeInTheDocument();
    expect(container.textContent).toBe('');
  });

  it('marks you, focus, selection and hidden relatives', () => {
    const { container } = view({
      isMe: true,
      isFocus: true,
      isSelected: true,
      person: { ...robert, hiddenRelatives: true },
    });
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('is-focus', 'is-selected');
    expect(
      screen.getByRole('button', {
        name: 'Robert Hale, 1930–1998, deceased, you, more relatives not shown',
      }),
    ).toBeInTheDocument();
    expect(screen.getByTitle('More relatives not shown')).toBeInTheDocument();
  });

  it('renders user text literally', () => {
    const { container } = view({ person: { ...robert, givenName: '<b>x</b>' } });
    expect(screen.getByText('<b>x</b> Hale')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
  });

  describe('photo', () => {
    const withPhoto = { ...robert, photoThumbUrl: 'https://photos.test/r/thumb' };

    it('shows the thumbnail on a full card without changing the name', () => {
      const { container } = view({ person: withPhoto });
      const img = container.querySelector('img');
      expect(img).toHaveAttribute('src', 'https://photos.test/r/thumb');
      expect(img).toHaveAttribute('alt', '');
      expect(
        screen.getByRole('button', { name: 'Robert Hale, 1930–1998, deceased' }),
      ).toBeInTheDocument();
    });

    it('falls back to initials when the image fails', () => {
      const { container } = view({ person: withPhoto });
      fireEvent.error(container.querySelector('img')!);
      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByText('RH')).toBeInTheDocument();
    });

    it('shows initials without a url', () => {
      view();
      expect(screen.getByText('RH')).toBeInTheDocument();
    });

    it('renders no image on name-only and dot cards', () => {
      for (const d of ['compact', 'dot'] as const) {
        const { container, unmount } = view({ person: withPhoto }, d);
        expect(container.querySelector('img')).toBeNull();
        unmount();
      }
    });
  });
});
