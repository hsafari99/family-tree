import { afterEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES, SESSION_EXPIRED, toAuthError } from '../auth/api';
import { createTreesApi } from './api';

const BASE = 'https://api.example.com';
const ID = '6f9619ff-8b86-4d11-b42d-00c04fc964ff';

afterEach(() => {
  vi.unstubAllGlobals();
});

type Reply = { status: number; body?: unknown };

function stubFetch(...replies: Reply[]) {
  const mock = vi.fn<typeof fetch>(async () => {
    const next = replies.shift() ?? { status: 500 };
    return new Response(
      next.status === 204 || next.body === undefined ? null : JSON.stringify(next.body),
      {
        status: next.status,
        headers: { 'content-type': 'application/json' },
      },
    );
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const urlOf = (call: unknown[]) => String(call[0]);
const initOf = (call: unknown[]) => (call[1] ?? {}) as RequestInit;
const api = () => createTreesApi({ baseUrl: BASE });
const errorBody = (code: string) => ({ error: { code, message: 'server text' } });

describe('createTreesApi', () => {
  it('lists trees with credentials and returns the parsed body', async () => {
    const body = { trees: [{ id: ID, name: 'Hale family', role: 'owner' }], deletedTrees: [] };
    const mock = stubFetch({ status: 200, body });
    const res = await api().listTrees();
    expect(res).toEqual({ ok: true, data: body });
    expect(urlOf(mock.mock.calls[0]!)).toBe(`${BASE}/api/v1/trees`);
    expect(initOf(mock.mock.calls[0]!).credentials).toBe('include');
  });

  it('creates a tree with a JSON body and returns its id', async () => {
    const mock = stubFetch({ status: 201, body: { tree: { id: ID } } });
    const res = await api().createTree({ name: 'Hale family', person: { givenName: 'Ada' } });
    expect(res).toEqual({ ok: true, data: { id: ID } });
    const init = initOf(mock.mock.calls[0]!);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'Hale family',
      person: { givenName: 'Ada' },
    });
  });

  it('sends no body or content-type for DELETE, and treats 204 as ok', async () => {
    const mock = stubFetch({ status: 204 });
    const res = await api().deleteTree(ID);
    expect(res).toEqual({ ok: true, data: undefined });
    const init = initOf(mock.mock.calls[0]!);
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
  });

  it.each([
    ['QUOTA_EXCEEDED', 403, MESSAGES.quota],
    ['TWO_FACTOR_REQUIRED', 403, MESSAGES.twoFactorRequired],
    ['INVALID_INVITE', 400, MESSAGES.invalidInvite],
    ['RESET_LINK_NOT_ALLOWED', 403, MESSAGES.resetNotAllowed],
    ['FORBIDDEN', 403, MESSAGES.forbidden],
    ['NOT_FOUND', 404, MESSAGES.notFound],
  ])('maps %s to a fixed message', async (code, status, message) => {
    stubFetch({ status, body: errorBody(code) });
    expect(await api().getTree(ID)).toEqual({ ok: false, error: { code, message } });
  });

  it('maps a 401 to SESSION_EXPIRED', async () => {
    stubFetch({ status: 401 });
    const res = await api().listTrees();
    expect(res).toEqual({
      ok: false,
      error: { code: SESSION_EXPIRED, message: MESSAGES.sessionExpired },
    });
  });

  it('does not treat a 401 on the public invite preview as session expiry', async () => {
    stubFetch({ status: 401 });
    const res = await api().previewInvite('t'.repeat(30));
    expect(res).toEqual({ ok: false, error: toAuthError(401) });
  });

  it('reports a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')));
    expect(await api().listTrees()).toEqual({
      ok: false,
      error: { code: 'NETWORK', message: MESSAGES.network },
    });
  });

  it('gives the generic message for an unexpected 200 body', async () => {
    stubFetch({ status: 200, body: { nope: true } });
    expect(await api().listTrees()).toEqual({ ok: false, error: toAuthError(500) });
  });

  it('encodes ids in paths', async () => {
    const mock = stubFetch({ status: 204 });
    await api().removeMember('a/b', 'c d');
    expect(urlOf(mock.mock.calls[0]!)).toBe(`${BASE}/api/v1/trees/a%2Fb/members/c%20d`);
  });

  it('posts invite tokens in the body, never the URL', async () => {
    const token = 't'.repeat(30);
    const mock = stubFetch({ status: 200, body: { treeId: ID } });
    const res = await api().acceptInvite(token);
    expect(res).toEqual({ ok: true, data: { treeId: ID } });
    expect(urlOf(mock.mock.calls[0]!)).toBe(`${BASE}/api/v1/invites/accept`);
    expect(JSON.parse(initOf(mock.mock.calls[0]!).body as string)).toEqual({ token });
  });

  describe('people, relations and Trash', () => {
    const PID = '7f9619ff-8b86-4d11-b42d-00c04fc964aa';
    const summary = {
      id: PID,
      givenName: 'Ada',
      middleName: null,
      surname: null,
      birthYear: null,
      deathYear: null,
      isLiving: true,
    };
    const view = {
      person: {
        id: PID,
        givenName: 'Ada',
        middleName: null,
        surname: null,
        maidenName: null,
        nickname: null,
        sex: 'female',
        birthDate: null,
        birthPlace: null,
        deathDate: null,
        deathPlace: null,
        causeOfDeath: null,
        isLiving: true,
        occupation: null,
        education: null,
        biography: null,
        notes: null,
        version: 1,
        createdByName: null,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      residences: [],
      relations: { parents: [], unions: [], siblings: [] },
      capabilities: { edit: true, addRelative: true, delete: true },
    };

    it('reads a person', async () => {
      const mock = stubFetch({ status: 200, body: view });
      expect(await api().getPerson('t', PID)).toEqual({ ok: true, data: view });
      expect(urlOf(mock.mock.calls[0]!)).toBe(`${BASE}/api/v1/trees/t/persons/${PID}`);
    });

    it('creates a person and returns its id', async () => {
      const mock = stubFetch({ status: 201, body: { id: PID } });
      const input = { person: { givenName: 'Ada' } };
      expect(await api().createPerson('t', input)).toEqual({ ok: true, data: { id: PID } });
      const init = initOf(mock.mock.calls[0]!);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual(input);
    });

    it('maps a stale edit to its own message', async () => {
      stubFetch({ status: 409, body: errorBody('CONFLICT') });
      expect(await api().updatePerson('t', PID, { version: 1, givenName: 'B' })).toEqual({
        ok: false,
        error: { code: 'CONFLICT', message: MESSAGES.staleEdit },
      });
    });

    it('maps a restore conflict', async () => {
      stubFetch({ status: 409, body: errorBody('CONFLICT') });
      expect(await api().restoreBatch('t', ID)).toEqual({
        ok: false,
        error: { code: 'CONFLICT', message: MESSAGES.restoreConflict },
      });
    });

    it('maps a forbidden Trash list', async () => {
      stubFetch({ status: 403, body: errorBody('FORBIDDEN') });
      expect(await api().listTrash('t')).toEqual({
        ok: false,
        error: { code: 'FORBIDDEN', message: MESSAGES.trashOwnerOnly },
      });
    });

    it('maps a forbidden delete', async () => {
      stubFetch({ status: 403, body: errorBody('FORBIDDEN') });
      expect(await api().deletePerson('t', PID, 'person')).toEqual({
        ok: false,
        error: { code: 'FORBIDDEN', message: MESSAGES.deleteNotAllowed },
      });
    });

    it('maps a relation conflict', async () => {
      stubFetch({ status: 409, body: errorBody('CONFLICT') });
      expect(await api().addRelative('t', PID, { as: 'partner', personId: ID })).toEqual({
        ok: false,
        error: { code: 'CONFLICT', message: MESSAGES.alreadyRelated },
      });
    });

    it('deletes a residence with no body', async () => {
      const mock = stubFetch({ status: 204 });
      expect(await api().deleteResidence('t', ID)).toEqual({ ok: true, data: undefined });
      const init = initOf(mock.mock.calls[0]!);
      expect(init.method).toBe('DELETE');
      expect(init.body).toBeUndefined();
      expect(urlOf(mock.mock.calls[0]!)).toBe(`${BASE}/api/v1/trees/t/residences/${ID}`);
    });

    it('previews a delete with the mode', async () => {
      const body = {
        mode: 'descendants',
        people: [summary],
        unions: 0,
        links: 0,
        outsideScope: 0,
        blockedByRoot: false,
        allowed: true,
      };
      const mock = stubFetch({ status: 200, body });
      expect(await api().previewDelete('t', PID, 'descendants')).toEqual({ ok: true, data: body });
      expect(urlOf(mock.mock.calls[0]!)).toBe(
        `${BASE}/api/v1/trees/t/persons/${PID}/delete-preview`,
      );
      expect(JSON.parse(initOf(mock.mock.calls[0]!).body as string)).toEqual({
        mode: 'descendants',
      });
    });

    it('unwraps history and Trash lists', async () => {
      stubFetch({ status: 200, body: { entries: [] } }, { status: 200, body: { batches: [] } });
      expect(await api().personHistory('t', PID)).toEqual({ ok: true, data: [] });
      expect(await api().listTrash('t')).toEqual({ ok: true, data: [] });
    });

    it('gives the generic error for an unexpected body', async () => {
      stubFetch({ status: 200, body: { nope: true } });
      expect(await api().getPerson('t', PID)).toEqual({ ok: false, error: toAuthError(500) });
    });
  });
});

describe('graph, disconnected, similar and child-order', () => {
  const PID = '7f9619ff-8b86-4d11-b42d-00c04fc964aa';
  const UID = '8f9619ff-8b86-4d11-b42d-00c04fc964bb';
  const graph = {
    mode: 'focus',
    focusId: PID,
    branchId: null,
    persons: [],
    unions: [],
    links: [],
    total: 0,
    truncated: false,
    needsBranch: false,
  };
  const summary = {
    id: PID,
    givenName: 'Ada',
    middleName: null,
    surname: null,
    birthYear: null,
    deathYear: null,
    isLiving: true,
  };

  it('gets the graph with its query', async () => {
    const mock = stubFetch(
      { status: 200, body: graph },
      { status: 200, body: { ...graph, mode: 'full' } },
    );
    expect(await api().getGraph('t', { mode: 'focus', focus: PID, depth: 2 })).toEqual({
      ok: true,
      data: graph,
    });
    expect(urlOf(mock.mock.calls[0]!)).toBe(
      `${BASE}/api/v1/trees/t/graph?mode=focus&focus=${PID}&depth=2`,
    );
    await api().getGraph('t', { mode: 'full' });
    expect(urlOf(mock.mock.calls[1]!)).toBe(`${BASE}/api/v1/trees/t/graph?mode=full`);
  });

  it('passes an abort signal to fetch for the graph', async () => {
    const mock = stubFetch({ status: 200, body: graph });
    const ctl = new AbortController();
    await api().getGraph('t', {}, ctl.signal);
    expect(initOf(mock.mock.calls[0]!).signal).toBe(ctl.signal);
  });

  it('lists disconnected people', async () => {
    const mock = stubFetch({ status: 200, body: { persons: [summary] } });
    expect(await api().listDisconnected('t')).toEqual({ ok: true, data: [summary] });
    expect(urlOf(mock.mock.calls[0]!)).toBe(`${BASE}/api/v1/trees/t/disconnected`);
  });

  it('finds similar people, leaving out undefined and blank values', async () => {
    const mock = stubFetch(
      { status: 200, body: { persons: [summary] } },
      { status: 200, body: { persons: [] } },
    );
    expect(
      await api().findSimilar('t', { givenName: 'Ada', surname: undefined, birthYear: 1815 }),
    ).toEqual({ ok: true, data: [summary] });
    expect(urlOf(mock.mock.calls[0]!)).toBe(
      `${BASE}/api/v1/trees/t/persons/similar?givenName=Ada&birthYear=1815`,
    );
    await api().findSimilar('t', { givenName: 'Ada', surname: '' });
    expect(urlOf(mock.mock.calls[1]!)).toBe(`${BASE}/api/v1/trees/t/persons/similar?givenName=Ada`);
  });

  it('reorders children, and maps a 409 to the changed message', async () => {
    const mock = stubFetch({ status: 204 }, { status: 409, body: errorBody('CONFLICT') });
    expect(await api().reorderChildren('t', UID, [PID, ID])).toEqual({ ok: true, data: undefined });
    expect(urlOf(mock.mock.calls[0]!)).toBe(`${BASE}/api/v1/trees/t/unions/${UID}/child-order`);
    expect(initOf(mock.mock.calls[0]!).method).toBe('POST');
    expect(JSON.parse(initOf(mock.mock.calls[0]!).body as string)).toEqual({ childIds: [PID, ID] });
    expect(await api().reorderChildren('t', UID, [ID, PID])).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', message: MESSAGES.itemChanged },
    });
  });

  it('gives the generic error for a graph body that does not match', async () => {
    stubFetch({ status: 200, body: { persons: 'nope' } });
    expect(await api().getGraph('t', {})).toEqual({ ok: false, error: toAuthError(500) });
  });
});
