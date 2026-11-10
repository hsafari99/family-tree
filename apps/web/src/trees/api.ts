import {
  acceptedInviteSchema,
  apiErrorSchema,
  type CreatedInvite,
  type CreateInviteInput,
  createdIdSchema,
  createdInviteSchema,
  createdTreeSchema,
  type CreateTreeInput,
  type Invite,
  inviteListSchema,
  type InvitePreview,
  invitePreviewSchema,
  type InviteRole,
  type Member,
  memberListSchema,
  type PersonSummary,
  personListSchema,
  type ResetLinkCreated,
  resetLinkCreatedSchema,
  type StewardGrant,
  stewardListSchema,
  type TreeDetail,
  treeDetailSchema,
  type TreeList,
  treeListSchema,
  type UpdateTreeInput,
} from '@family-tree/shared';
import { type CallKind, MESSAGES, type Result, toAuthError } from '../auth/api';

/** Everything the tree pages need. Tests use FakeTreesApi (test/fake-trees.ts). */
export interface TreesApi {
  listTrees(): Promise<Result<TreeList>>;
  createTree(input: CreateTreeInput): Promise<Result<{ id: string }>>;
  getTree(treeId: string): Promise<Result<TreeDetail>>;
  updateTree(treeId: string, input: UpdateTreeInput): Promise<Result<void>>;
  deleteTree(treeId: string): Promise<Result<void>>;
  restoreTree(treeId: string): Promise<Result<void>>;
  listPersons(treeId: string): Promise<Result<PersonSummary[]>>;
  listMembers(treeId: string): Promise<Result<Member[]>>;
  changeRole(treeId: string, userId: string, role: InviteRole): Promise<Result<void>>;
  removeMember(treeId: string, userId: string): Promise<Result<void>>;
  transferOwnership(treeId: string, userId: string): Promise<Result<void>>;
  createResetLink(treeId: string, userId: string): Promise<Result<ResetLinkCreated>>;
  listStewards(treeId: string): Promise<Result<StewardGrant[]>>;
  grantSteward(
    treeId: string,
    input: { userId: string; anchorPersonId: string },
  ): Promise<Result<{ id: string }>>;
  revokeSteward(treeId: string, grantId: string): Promise<Result<void>>;
  listInvites(treeId: string): Promise<Result<Invite[]>>;
  createInvite(treeId: string, input: CreateInviteInput): Promise<Result<CreatedInvite>>;
  revokeInvite(treeId: string, inviteId: string): Promise<Result<void>>;
  previewInvite(token: string): Promise<Result<InvitePreview>>;
  acceptInvite(token: string): Promise<Result<{ treeId: string }>>;
}

/** Every TreesApi method; the Record type makes the compiler flag a missing one. */
export const TREES_API_METHODS = Object.keys({
  listTrees: true,
  createTree: true,
  getTree: true,
  updateTree: true,
  deleteTree: true,
  restoreTree: true,
  listPersons: true,
  listMembers: true,
  changeRole: true,
  removeMember: true,
  transferOwnership: true,
  createResetLink: true,
  listStewards: true,
  grantSteward: true,
  revokeSteward: true,
  listInvites: true,
  createInvite: true,
  revokeInvite: true,
  previewInvite: true,
  acceptInvite: true,
} satisfies Record<keyof TreesApi, true>) as (keyof TreesApi)[];

/** The part of a Zod schema `request` uses (keeps zod out of this package's dependencies). */
interface Parser<T> {
  safeParse(v: unknown): { success: true; data: T } | { success: false };
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export function createTreesApi({ baseUrl }: { baseUrl: string }): TreesApi {
  const origin = baseUrl.replace(/\/+$/, '');
  const enc = encodeURIComponent;
  const t = (treeId: string) => `/trees/${enc(treeId)}`;

  async function request<T>(
    method: Method,
    path: string,
    body?: unknown,
    parser?: Parser<T>,
    kind: CallKind = 'session',
  ): Promise<Result<T>> {
    let res: Response;
    try {
      res = await fetch(`${origin}/api/v1${path}`, {
        method,
        credentials: 'include',
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
    } catch {
      return { ok: false, error: { code: 'NETWORK', message: MESSAGES.network } };
    }
    if (!res.ok) {
      const parsed = apiErrorSchema.safeParse(await res.json().catch(() => null));
      return {
        ok: false,
        error: toAuthError(res.status, parsed.success ? parsed.data.error.code : undefined, kind),
      };
    }
    if (!parser) return { ok: true, data: undefined as T };
    const parsed = parser.safeParse(await res.json().catch(() => null));
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, error: toAuthError(500) };
  }

  const map = async <A, B>(r: Promise<Result<A>>, f: (a: A) => B): Promise<Result<B>> => {
    const res = await r;
    return res.ok ? { ok: true, data: f(res.data) } : res;
  };

  return {
    listTrees: () => request('GET', '/trees', undefined, treeListSchema),
    createTree: (input) => map(request('POST', '/trees', input, createdTreeSchema), (d) => d.tree),
    getTree: (id) => request('GET', t(id), undefined, treeDetailSchema),
    updateTree: (id, input) => request('PATCH', t(id), input),
    deleteTree: (id) => request('DELETE', t(id)),
    restoreTree: (id) => request('POST', `${t(id)}/restore`, {}),
    listPersons: (id) =>
      map(request('GET', `${t(id)}/persons`, undefined, personListSchema), (d) => d.persons),
    listMembers: (id) =>
      map(request('GET', `${t(id)}/members`, undefined, memberListSchema), (d) => d.members),
    changeRole: (id, userId, role) => request('PATCH', `${t(id)}/members/${enc(userId)}`, { role }),
    removeMember: (id, userId) => request('DELETE', `${t(id)}/members/${enc(userId)}`),
    transferOwnership: (id, userId) => request('POST', `${t(id)}/transfer`, { userId }),
    createResetLink: (id, userId) =>
      request('POST', `${t(id)}/members/${enc(userId)}/reset-link`, {}, resetLinkCreatedSchema),
    listStewards: (id) =>
      map(request('GET', `${t(id)}/stewards`, undefined, stewardListSchema), (d) => d.stewards),
    grantSteward: (id, input) => request('POST', `${t(id)}/stewards`, input, createdIdSchema),
    revokeSteward: (id, grantId) => request('DELETE', `${t(id)}/stewards/${enc(grantId)}`),
    listInvites: (id) =>
      map(request('GET', `${t(id)}/invites`, undefined, inviteListSchema), (d) => d.invites),
    createInvite: (id, input) => request('POST', `${t(id)}/invites`, input, createdInviteSchema),
    revokeInvite: (id, inviteId) => request('DELETE', `${t(id)}/invites/${enc(inviteId)}`),
    previewInvite: (token) =>
      request('POST', '/invites/preview', { token }, invitePreviewSchema, 'public'),
    acceptInvite: (token) => request('POST', '/invites/accept', { token }, acceptedInviteSchema),
  };
}
