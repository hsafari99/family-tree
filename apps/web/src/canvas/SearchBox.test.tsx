import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { SearchQuery } from '@family-tree/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES, toAuthError } from '../auth/api';
import { FakeAuthApi } from '../test/fake-auth';
import { FakeTreesApi, fakePerson } from '../test/fake-trees';
import { renderAt } from '../test/render';
import { haleGraph } from './test-fixtures';

const hale = haleGraph();
const summaries = hale.persons.map(({ id, givenName, surname, birthYear, deathYear, isLiving }) =>
  fakePerson({ id, givenName, surname, birthYear, deathYear, isLiving, middleName: null }),
);
const lone = fakePerson({ id: 'lone', givenName: 'Lone', surname: 'Wolf' });

function setup(meId: string | null = 'leo', trees = new FakeTreesApi()) {
  const auth = new FakeAuthApi();
  auth.addUser({ email: 'a@example.com', name: 'A', twoFactorEnabled: true }, { signedIn: true });
  const id = trees.addTree({
    name: 'Hale family',
    persons: [...summaries, lone].map((p) => ({ ...p })),
    detail: {
      me: { role: 'owner', personId: meId, steward: { grants: [], active: false } },
    },
  });
  trees.trees.get(id)!.graph = { ...hale, mode: 'focus', focusId: 'robert' };
  return { auth, trees, id };
}
const searchCalls = (t: FakeTreesApi) =>
  t.callsTo('search').map((c) => (c as { query: SearchQuery }).query);
const box = () => screen.findByLabelText('Search');
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const hit = async (name: RegExp) =>
  within(await screen.findByRole('list', { name: 'Search results' })).getByRole('button', { name });
const settle = () => act(() => vi.advanceTimersByTimeAsync(300));

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe('SearchBox', () => {
  it('searches once after the debounce and shows the relation to you', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
    const input = await box();
    type(input, 'm');
    type(input, 'ma');
    type(input, 'marg');
    expect(searchCalls(s.trees)).toHaveLength(0);
    await settle();
    expect(searchCalls(s.trees)).toEqual([{ q: 'marg', limit: 20 }]);
    await waitFor(() =>
      expect(document.querySelector('.search-box [role="status"]')).toHaveTextContent(
        '1 person found',
      ),
    );
    const result = await hit(/Margaret Hale/);
    expect(result).toHaveTextContent('1932');
    expect(result).toHaveTextContent('Your grandparent');
  });

  it('words the relation line, and omits it without your card', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
    const input = await box();
    // "Leo Hale" is you; "Lone Wolf" has no path.
    type(input, 'leo');
    await settle();
    expect(await hit(/Leo Hale/)).toHaveTextContent('You');
    type(input, 'lone');
    await settle();
    expect(await hit(/Lone Wolf/)).toHaveTextContent('Not connected to you');
  });

  it('shows no relation line when you have no card', async () => {
    const s = setup(null);
    renderAt(`/trees/${s.id}`, s);
    type(await box(), 'margaret');
    await settle();
    const result = await hit(/Margaret Hale/);
    expect(result).not.toHaveTextContent('Your');
    expect(result).not.toHaveTextContent('Not connected');
  });

  it('opens the person and closes the results on choosing', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
    type(await box(), 'marg');
    await settle();
    fireEvent.click(await hit(/Margaret Hale/));
    expect(await screen.findByRole('complementary', { name: 'Details' })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        s.trees.callsTo('getGraph').map((c) => (c as { query: unknown }).query),
      ).toContainEqual({ mode: 'focus', focus: 'margaret', depth: 1 }),
    );
    expect(screen.queryByRole('list', { name: 'Search results' })).toBeNull();
    expect(screen.getByLabelText('Search')).toHaveValue('');
  });

  it('clears the box and results on Escape', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
    const input = await box();
    type(input, 'marg');
    await settle();
    await screen.findByRole('list', { name: 'Search results' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('');
    expect(screen.queryByRole('list', { name: 'Search results' })).toBeNull();
  });

  it('filters by years and status without a name, and by branch', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
    const toggle = await screen.findByRole('button', { name: 'Filters' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    type(screen.getByLabelText('Born from'), '1900');
    type(screen.getByLabelText('Born to'), '1940');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'deceased' } });
    await settle();
    expect(searchCalls(s.trees)).toEqual([
      { bornFrom: 1900, bornTo: 1940, status: 'deceased', limit: 20 },
    ]);
    expect(screen.getByRole('button', { name: 'Filters (3)' })).toBeInTheDocument();
    type(screen.getByLabelText('In the branch of'), 'Susan');
    fireEvent.click(
      within(document.querySelector<HTMLElement>('.picker-matches')!).getByRole('button', {
        name: /Susan Hale/,
      }),
    );
    await settle();
    expect(searchCalls(s.trees).at(-1)).toMatchObject({ branch: 'susan' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
  });

  it('sends nothing for an empty box, a reversed range or a non-numeric year', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
    fireEvent.click(await screen.findByRole('button', { name: 'Filters' }));
    await settle();
    expect(searchCalls(s.trees)).toHaveLength(0);
    const from = screen.getByLabelText('Born from');
    const to = screen.getByLabelText('Born to');
    type(from, '2000');
    type(to, '1980');
    await settle();
    expect(screen.getByText('From must not be after to')).toBeInTheDocument();
    type(from, '19x0');
    await settle();
    expect(screen.getByText('Enter years as numbers, for example 1950')).toBeInTheDocument();
    expect(searchCalls(s.trees)).toHaveLength(0);
  });

  it('shows only the latest of two overlapping searches and aborts the first', async () => {
    class SlowTrees extends FakeTreesApi {
      signals: AbortSignal[] = [];
      private n = 0;
      override async search(treeId: string, query: SearchQuery, signal?: AbortSignal) {
        const nth = ++this.n;
        if (signal) this.signals.push(signal);
        if (nth === 1) await new Promise((r) => setTimeout(r, 600));
        return super.search(treeId, query, signal);
      }
    }
    const trees = new SlowTrees();
    const s = setup('leo', trees);
    renderAt(`/trees/${s.id}`, s);
    const input = await box();
    type(input, 'margaret');
    await act(() => vi.advanceTimersByTimeAsync(260));
    type(input, 'robert');
    await act(() => vi.advanceTimersByTimeAsync(260));
    expect(trees.signals[0]!.aborted).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(await hit(/Robert Hale/)).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Search results' })).queryByText(/Margaret/),
    ).toBeNull();
  });

  it('shows a fixed message when the search fails', async () => {
    const s = setup();
    s.trees.failNext('search', toAuthError(429));
    renderAt(`/trees/${s.id}`, s);
    type(await box(), 'marg');
    await settle();
    expect(await screen.findByText(MESSAGES.tooMany)).toBeInTheDocument();
  });

  it('Escape on a result does not close the side panel, and focus returns to the box', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/people/robert`, s);
    const input = await box();
    await screen.findByRole('complementary', { name: 'Details' });
    type(input, 'marg');
    await settle();
    const result = await hit(/Margaret Hale/);
    result.focus();
    fireEvent.keyDown(result, { key: 'Escape' });
    expect(screen.queryByRole('list', { name: 'Search results' })).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Details' })).toBeInTheDocument();
    expect(document.activeElement).toBe(input);
  });

  it('keeps the result count region mounted and changes only its text', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}`, s);
    const input = await box();
    const region = document.querySelector('.search-box [role="status"]')!;
    expect(region).toBeInTheDocument();
    expect(region).toHaveTextContent('');
    type(input, 'marg');
    await settle();
    await waitFor(() => expect(region).toHaveTextContent('1 person found'));
    expect(document.querySelector('.search-box [role="status"]')).toBe(region);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(region).toHaveTextContent('');
  });

  it('clears an old error when the query is cleared', async () => {
    const s = setup();
    s.trees.failNext('search', toAuthError(429));
    renderAt(`/trees/${s.id}`, s);
    const input = await box();
    type(input, 'marg');
    await settle();
    await screen.findByText(MESSAGES.tooMany);
    type(input, '');
    await settle();
    expect(screen.queryByText(MESSAGES.tooMany)).toBeNull();
  });
});
