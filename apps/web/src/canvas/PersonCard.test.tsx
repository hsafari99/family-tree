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
    expect(container.querySelector('.card-years')).toHaveTextContent('† 1930–1998');
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

  it('offers a sibling even when there are no parents (brief #11)', () => {
    const { onAdd } = view({ person: { ...robert, hasParents: false } });
    const b = screen.getByRole('button', { name: 'Add a sibling of Robert Hale' });
    expect(b).toBeEnabled();
    fireEvent.click(b);
    expect(onAdd).toHaveBeenCalledWith('sibling');
  });

  it('on a touch screen, shows the add buttons on the selected card only (a tap selects first)', () => {
    const { unmount } = view({ isCoarse: true });
    expect(screen.queryByRole('button', { name: /^Add a/ })).toBeNull();
    unmount();
    view({ isCoarse: true, isSelected: true });
    expect(screen.getAllByRole('button', { name: /^Add a/ })).toHaveLength(4);
  });

  it('gives each add button a tooltip with its title text', () => {
    view();
    const b = screen.getByRole('button', { name: 'Add a parent of Robert Hale' });
    expect(b).toHaveAttribute('data-tip', 'Add a parent');
  });

  it('arrow keys on the card ask the canvas to move, and nothing opens', () => {
    const onNavigate = vi.fn();
    const { onOpen } = view({ onNavigate });
    const b = screen.getByRole('button', { name: 'Robert Hale, 1930–1998, deceased' });
    for (const [key, dir] of [
      ['ArrowUp', 'up'],
      ['ArrowDown', 'down'],
      ['ArrowLeft', 'left'],
      ['ArrowRight', 'right'],
    ] as const) {
      expect(fireEvent.keyDown(b, { key })).toBe(false); // no page scroll
      expect(onNavigate).toHaveBeenLastCalledWith(dir);
    }
    expect(onOpen).not.toHaveBeenCalled();
    // With a modifier key the browser keeps it.
    expect(fireEvent.keyDown(b, { key: 'ArrowUp', altKey: true })).toBe(true);
  });

  it('has no add buttons without permission', () => {
    view({ person: { ...robert, canAddRelative: false } });
    expect(screen.queryByRole('button', { name: /^Add a/ })).toBeNull();
  });

  it('compact: the avatar and first name only, no years or add buttons', () => {
    const { container } = view({}, 'compact');
    expect(screen.getByText('RH')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Add a/ })).toBeNull();
    expect(screen.getByText('Robert')).toBeInTheDocument();
    expect(screen.queryByText('Robert Hale')).toBeNull();
    expect(container.querySelector('.card-years')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Robert Hale, 1930–1998, deceased' }),
    ).toBeInTheDocument();
  });

  it('dot: one named button, the avatar circle and no visible text', () => {
    const { container } = view({}, 'dot');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Robert Hale, 1930–1998, deceased' }),
    ).toBeInTheDocument();
    expect(container.querySelector('.card-avatar')).not.toBeNull();
    expect(container.textContent).toBe('');
  });

  it('shows initials on a stable tone when there is no photo', () => {
    const { container } = view();
    const avatar = container.querySelector('.card-avatar')!;
    expect(avatar).toHaveTextContent('RH');
    expect(avatar.className).toMatch(/\btone-[1-6]\b/);
    const again = view().container.querySelector('.card-avatar')!;
    expect(again.className).toBe(avatar.className);
  });

  it('puts the full name in a title on the one-line name', () => {
    view();
    expect(screen.getByText('Robert Hale')).toHaveAttribute('title', 'Robert Hale');
  });

  it.each([
    [{ birthYear: 1902, deathYear: 1978, isLiving: false }, '† 1902–1978'],
    [{ birthYear: 1986, deathYear: null, isLiving: true }, 'b. 1986'],
    [{ birthYear: null, deathYear: 1950, isLiving: false }, '† d. 1950'],
    [{ birthYear: null, deathYear: null, isLiving: false }, '†'],
  ])('formats the years %o as %s', (over, text) => {
    const { container } = view({ person: { ...robert, ...over } });
    expect(container.querySelector('.card-years')!.textContent!.trim()).toBe(text);
  });

  it('has no years line for a living person with no known years', () => {
    const { container } = view({
      person: { ...robert, birthYear: null, deathYear: null, isLiving: true },
    });
    expect(container.querySelector('.card-years')).toBeNull();
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

    it('renders no image on compact and dot cards (initials only)', () => {
      for (const d of ['compact', 'dot'] as const) {
        const { container, unmount } = view({ person: withPhoto }, d);
        expect(container.querySelector('img')).toBeNull();
        unmount();
      }
    });
  });

  it('a parent’s chevron hides their descendants; a collapsed card shows +N to bring them back', () => {
    const onToggleBranch = vi.fn();
    const { unmount } = view({ branch: { collapsed: false }, onToggleBranch });
    fireEvent.click(screen.getByRole('button', { name: 'Hide descendants of Robert Hale' }));
    expect(onToggleBranch).toHaveBeenCalledTimes(1);
    unmount();
    view({ branch: { collapsed: true, hidden: 4 }, onToggleBranch });
    const show = screen.getByRole('button', { name: 'Show 4 hidden descendants of Robert Hale' });
    expect(show).toHaveTextContent('+4');
    fireEvent.click(show);
    expect(onToggleBranch).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: /^Hide descendants/ })).toBeNull();
  });

  it('has no chevron without children shown', () => {
    view({ onToggleBranch: vi.fn() });
    expect(screen.queryByRole('button', { name: /descendants/ })).toBeNull();
  });
});
