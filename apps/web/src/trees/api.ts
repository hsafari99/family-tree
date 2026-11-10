import {
  acceptedInviteSchema,
  type AddRelativeInput,
  apiErrorSchema,
  batchIdSchema,
  type ChildKind,
  type CreatedInvite,
  type CreateInviteInput,
  createdIdSchema,
  createdInviteSchema,
  createdTreeSchema,
  type CreatePersonInput,
  type CreateTreeInput,
  type DeleteMode,
  type DeletePreview,
  deletePreviewSchema,
  type HistoryEntry,
  historySchema,
  type Invite,
  inviteListSchema,
  type InvitePreview,
  invitePreviewSchema,
  type InviteRole,
  type Member,
  memberListSchema,
  type PersonSummary,
  type PersonView,
  personViewSchema,
  type ResidenceInput,
  personListSchema,
  type ResetLinkCreated,
  resetLinkCreatedSchema,
  type StewardGrant,
  stewardListSchema,
  type TrashBatch,
  type TrashBatchDetail,
  trashBatchDetailSchema,
  trashListSchema,
  type TreeDetail,
  treeDetailSchema,
  type TreeList,
  treeListSchema,
  type UpdatePersonInput,
  type UpdateTreeInput,
  type UpdateUnionInput,
  updatedPersonSchema,
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
  getPerson(treeId: string, personId: string): Promise<Result<PersonView>>;
  createPerson(treeId: string, input: CreatePersonInput): Promise<Result<{ id: string }>>;
  updatePerson(
    treeId: string,
    personId: string,
    input: UpdatePersonInput,
  ): Promise<Result<{ version: number }>>;
  addRelative(treeId: string, personId: string, input: AddRelativeInput): Promise<Result<void>>;
  updateUnion(treeId: string, unionId: string, input: UpdateUnionInput): Promise<Result<void>>;
  deleteUnion(treeId: string, unionId: string): Promise<Result<{ batchId: string }>>;
  updateParentChild(
    treeId: string,
    linkId: string,
    input: { kind: ChildKind },
  ): Promise<Result<void>>;
  deleteParentChild(treeId: string, linkId: string): Promise<Result<{ batchId: string }>>;
  addResidence(
    treeId: string,
    personId: string,
    input: ResidenceInput,
  ): Promise<Result<{ id: string }>>;
  updateResidence(
    treeId: string,
    residenceId: string,
    input: ResidenceInput,
  ): Promise<Result<void>>;
  deleteResidence(treeId: string, residenceId: string): Promise<Result<void>>;
  previewDelete(treeId: string, personId: string, mode: DeleteMode): Promise<Result<DeletePreview>>;
  deletePerson(
    treeId: string,
    personId: string,
    mode: DeleteMode,
  ): Promise<Result<{ batchId: string }>>;
  personHistory(treeId: string, personId: string): Promise<Result<HistoryEntry[]>>;
  listTrash(treeId: string): Promise<Result<TrashBatch[]>>;
  getTrashBatch(treeId: string, batchId: string): Promise<Result<TrashBatchDetail>>;
  restoreBatch(treeId: string, batchId: string): Promise<Result<void>>;
  eraseBatch(treeId: string, batchId: string): Promise<Result<void>>;
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
  getPerson: true,
  createPerson: true,
  updatePerson: true,
  addRelative: true,
  updateUnion: true,
  deleteUnion: true,
  updateParentChild: true,
  deleteParentChild: true,
  addResidence: true,
  updateResidence: true,
  deleteResidence: true,
  previewDelete: true,
  deletePerson: true,
  personHistory: true,
  listTrash: true,
  getTrashBatch: true,
  restoreBatch: true,
  eraseBatch: true,
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
    codes?: Partial<Record<string, string>>,
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
      const error = toAuthError(
        res.status,
        parsed.success ? parsed.data.error.code : undefined,
        kind,
      );
      const override = codes?.[error.code];
      return { ok: false, error: override ? { ...error, message: override } : error };
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

  // FORBIDDEN on a delete call always means "outside your branch / not allowed to delete": the
  // server only answers 403 there when the actor's scope or role is too small, so one fixed
  // message (deleteNotAllowed) fits every delete call below.
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
    getPerson: (id, p) =>
      request('GET', `${t(id)}/persons/${enc(p)}`, undefined, personViewSchema, 'session', {
        NOT_FOUND: MESSAGES.personNotFound,
      }),
    createPerson: (id, input) =>
      request('POST', `${t(id)}/persons`, input, createdIdSchema, 'session', {
        CONFLICT: MESSAGES.alreadyRelated,
      }),
    updatePerson: (id, p, input) =>
      request('PATCH', `${t(id)}/persons/${enc(p)}`, input, updatedPersonSchema, 'session', {
        CONFLICT: MESSAGES.staleEdit,
      }),
    addRelative: (id, p, input) =>
      request('POST', `${t(id)}/persons/${enc(p)}/relatives`, input, undefined, 'session', {
        CONFLICT: MESSAGES.alreadyRelated,
      }),
    updateUnion: (id, u, input) => request('PATCH', `${t(id)}/unions/${enc(u)}`, input),
    deleteUnion: (id, u) =>
      request('POST', `${t(id)}/unions/${enc(u)}/delete`, {}, batchIdSchema, 'session', {
        FORBIDDEN: MESSAGES.deleteNotAllowed,
      }),
    updateParentChild: (id, l, input) => request('PATCH', `${t(id)}/parent-child/${enc(l)}`, input),
    deleteParentChild: (id, l) =>
      request('POST', `${t(id)}/parent-child/${enc(l)}/delete`, {}, batchIdSchema, 'session', {
        FORBIDDEN: MESSAGES.deleteNotAllowed,
      }),
    addResidence: (id, p, input) =>
      request('POST', `${t(id)}/persons/${enc(p)}/residences`, input, createdIdSchema),
    updateResidence: (id, r, input) => request('PATCH', `${t(id)}/residences/${enc(r)}`, input),
    deleteResidence: (id, r) => request('DELETE', `${t(id)}/residences/${enc(r)}`),
    previewDelete: (id, p, mode) =>
      request('POST', `${t(id)}/persons/${enc(p)}/delete-preview`, { mode }, deletePreviewSchema),
    deletePerson: (id, p, mode) =>
      request('POST', `${t(id)}/persons/${enc(p)}/delete`, { mode }, batchIdSchema, 'session', {
        FORBIDDEN: MESSAGES.deleteNotAllowed,
      }),
    personHistory: (id, p) =>
      map(
        request('GET', `${t(id)}/persons/${enc(p)}/history`, undefined, historySchema),
        (d) => d.entries,
      ),
    listTrash: (id) =>
      map(
        request('GET', `${t(id)}/trash`, undefined, trashListSchema, 'session', {
          FORBIDDEN: MESSAGES.trashOwnerOnly,
        }),
        (d) => d.batches,
      ),
    getTrashBatch: (id, b) =>
      request('GET', `${t(id)}/trash/${enc(b)}`, undefined, trashBatchDetailSchema, 'session', {
        FORBIDDEN: MESSAGES.trashOwnerOnly,
        NOT_FOUND: MESSAGES.itemGone,
      }),
    restoreBatch: (id, b) =>
      request('POST', `${t(id)}/trash/${enc(b)}/restore`, {}, undefined, 'session', {
        CONFLICT: MESSAGES.restoreConflict,
        NOT_FOUND: MESSAGES.itemGone,
      }),
    eraseBatch: (id, b) =>
      request('DELETE', `${t(id)}/trash/${enc(b)}`, undefined, undefined, 'session', {
        NOT_FOUND: MESSAGES.itemGone,
      }),
  };
}
