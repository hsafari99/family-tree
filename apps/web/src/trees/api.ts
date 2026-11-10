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
  type GraphQuery,
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
  type Relationship,
  relationshipSchema,
  type ResidenceInput,
  type SearchQuery,
  type SearchResult,
  searchResponseSchema,
  type UploadedPhoto,
  uploadedPhotoSchema,
  personListSchema,
  type SimilarQuery,
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
  type TreeGraph,
  treeGraphSchema,
  type TreeList,
  treeListSchema,
  type UpdatePersonInput,
  type UpdateTreeInput,
  type UpdateUnionInput,
  updatedPersonSchema,
} from '@family-tree/shared';
import { type AuthError, type CallKind, MESSAGES, type Result, toAuthError } from '../auth/api';
import { fileNameFrom } from './download';

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
  getGraph(treeId: string, query: GraphQuery, signal?: AbortSignal): Promise<Result<TreeGraph>>;
  listDisconnected(treeId: string): Promise<Result<PersonSummary[]>>;
  findSimilar(treeId: string, query: SimilarQuery): Promise<Result<PersonSummary[]>>;
  reorderChildren(treeId: string, unionId: string, childIds: string[]): Promise<Result<void>>;
  uploadPhoto(treeId: string, personId: string, file: Blob): Promise<Result<UploadedPhoto>>;
  setPrimaryPhoto(treeId: string, photoId: string): Promise<Result<void>>;
  deletePhoto(treeId: string, photoId: string): Promise<Result<void>>;
  search(treeId: string, query: SearchQuery, signal?: AbortSignal): Promise<Result<SearchResult[]>>;
  relationship(treeId: string, from: string, to: string): Promise<Result<Relationship>>;
  exportTree(treeId: string): Promise<Result<{ blob: Blob; fileName: string }>>;
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
  getGraph: true,
  listDisconnected: true,
  findSimilar: true,
  reorderChildren: true,
  uploadPhoto: true,
  setPrimaryPhoto: true,
  deletePhoto: true,
  search: true,
  relationship: true,
  exportTree: true,
} satisfies Record<keyof TreesApi, true>) as (keyof TreesApi)[];

/** The part of a Zod schema `request` uses (keeps zod out of this package's dependencies). */
interface Parser<T> {
  safeParse(v: unknown): { success: true; data: T } | { success: false };
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** `?a=1&b=2`, leaving out undefined and blank values; '' when nothing is left. */
function qs(q: Record<string, string | number | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
}

export function createTreesApi({ baseUrl }: { baseUrl: string }): TreesApi {
  const origin = baseUrl.replace(/\/+$/, '');
  const enc = encodeURIComponent;
  const t = (treeId: string) => `/trees/${enc(treeId)}`;

  /** An API error response as a fixed message (codes and reasons map to MESSAGES). */
  async function errorFrom(
    res: Response,
    kind: CallKind,
    codes?: Partial<Record<string, string>>,
    reasons?: Partial<Record<string, string>>,
  ): Promise<AuthError> {
    const parsed = apiErrorSchema.safeParse(await res.json().catch(() => null));
    const error = toAuthError(
      res.status,
      parsed.success ? parsed.data.error.code : undefined,
      kind,
    );
    const reason = parsed.success
      ? (parsed.data.error.details as { reason?: unknown } | undefined)?.reason
      : undefined;
    const override =
      (typeof reason === 'string' ? reasons?.[reason] : undefined) ?? codes?.[error.code];
    return override ? { ...error, message: override } : error;
  }

  async function request<T>(
    method: Method,
    path: string,
    body?: unknown,
    parser?: Parser<T>,
    kind: CallKind = 'session',
    codes?: Partial<Record<string, string>>,
    signal?: AbortSignal,
    /** VALIDATION `details.reason` → fixed message (photos, decision 15). */
    reasons?: Partial<Record<string, string>>,
  ): Promise<Result<T>> {
    let res: Response;
    try {
      res = await fetch(`${origin}/api/v1${path}`, {
        method,
        credentials: 'include',
        ...(signal ? { signal } : {}),
        ...(body === undefined
          ? {}
          : body instanceof Blob
            ? { headers: { 'content-type': body.type || 'application/octet-stream' }, body }
            : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
    } catch {
      return { ok: false, error: { code: 'NETWORK', message: MESSAGES.network } };
    }
    if (!res.ok) return { ok: false, error: await errorFrom(res, kind, codes, reasons) };
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
    getGraph: (id, query, signal) =>
      request(
        'GET',
        `${t(id)}/graph${qs(query)}`,
        undefined,
        treeGraphSchema,
        'session',
        undefined,
        signal,
      ),
    listDisconnected: (id) =>
      map(request('GET', `${t(id)}/disconnected`, undefined, personListSchema), (d) => d.persons),
    findSimilar: (id, query) =>
      map(
        request('GET', `${t(id)}/persons/similar${qs(query)}`, undefined, personListSchema),
        (d) => d.persons,
      ),
    reorderChildren: (id, u, childIds) =>
      request('POST', `${t(id)}/unions/${enc(u)}/child-order`, { childIds }, undefined, 'session', {
        CONFLICT: MESSAGES.itemChanged,
      }),
    uploadPhoto: (id, p, file) =>
      request(
        'POST',
        `${t(id)}/persons/${enc(p)}/photos`,
        file,
        uploadedPhotoSchema,
        'session',
        { QUOTA_EXCEEDED: MESSAGES.photoQuota, NOT_FOUND: MESSAGES.personNotFound },
        undefined,
        {
          type: MESSAGES.photoType,
          tooLarge: MESSAGES.photoTooLarge,
          dimensions: MESSAGES.photoDimensions,
          unreadable: MESSAGES.photoUnreadable,
          tooMany: MESSAGES.photoTooMany,
        },
      ),
    setPrimaryPhoto: (id, photoId) =>
      request('POST', `${t(id)}/photos/${enc(photoId)}/primary`, {}, undefined, 'session', {
        NOT_FOUND: MESSAGES.itemGone,
      }),
    deletePhoto: (id, photoId) =>
      request('DELETE', `${t(id)}/photos/${enc(photoId)}`, undefined, undefined, 'session', {
        NOT_FOUND: MESSAGES.itemGone,
      }),
    search: (id, query, signal) =>
      map(
        request(
          'GET',
          `${t(id)}/search${qs(query as Record<string, string | number | undefined>)}`,
          undefined,
          searchResponseSchema,
          'session',
          undefined,
          signal,
        ),
        (d) => d.results,
      ),
    exportTree: async (treeId) => {
      let res: Response;
      try {
        res = await fetch(`${origin}/api/v1${t(treeId)}/export`, { credentials: 'include' });
      } catch {
        return { ok: false, error: { code: 'NETWORK', message: MESSAGES.network } };
      }
      if (!res.ok) {
        return {
          ok: false,
          error: await errorFrom(
            res,
            'session',
            { RATE_LIMITED: MESSAGES.exportLimited },
            { tooLarge: MESSAGES.exportTooLarge },
          ),
        };
      }
      try {
        const blob = await res.blob();
        return {
          ok: true,
          data: { blob, fileName: fileNameFrom(res.headers.get('content-disposition')) },
        };
      } catch {
        return { ok: false, error: { code: 'NETWORK', message: MESSAGES.network } };
      }
    },
    relationship: (id, from, to) =>
      request('GET', `${t(id)}/relationship${qs({ from, to })}`, undefined, relationshipSchema),
  };
}
