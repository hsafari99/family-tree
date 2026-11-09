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
});
