import type {
  CreatedInvite,
  CreateInviteInput,
  CreateTreeInput,
  Invite,
  InvitePreview,
  InviteRole,
  Member,
  PersonSummary,
  ResetLinkCreated,
  StewardGrant,
  TreeDetail,
  TreeList,
  UpdateTreeInput,
} from '@family-tree/shared';
import type { AuthError, Result } from '../auth/api';
import { MESSAGES } from '../auth/api';
import type { TreesApi } from '../trees/api';

type Method = keyof TreesApi;

export interface FakeTree {
  detail: TreeDetail;
  persons: PersonSummary[];
  members: Member[];
  stewards: StewardGrant[];
  invites: Invite[];
}

export interface FakeDeletedTree {
  id: string;
  name: string;
  deletedAt: string;
  restoreUntil: string;
  /** The viewer's role in the tree; only owners can restore it. */
  role: TreeDetail['me']['role'];
  tree: FakeTree;
}

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (code: string, message: string): Result<never> => ({
  ok: false,
  error: { code, message },
});
const notFound = () => fail('NOT_FOUND', MESSAGES.notFound);
const forbidden = () => fail('FORBIDDEN', MESSAGES.forbidden);

export function fakePerson(partial: Partial<PersonSummary> = {}): PersonSummary {
  return {
    id: crypto.randomUUID(),
    givenName: 'Ada',
    middleName: null,
    surname: 'Lovelace',
    birthYear: 1815,
    deathYear: 1852,
    isLiving: false,
    ...partial,
  };
}

/** An in-memory TreesApi. Tests can seed trees, force errors and inspect calls. */
export class FakeTreesApi implements TreesApi {
  trees = new Map<string, FakeTree>();
  deletedTrees = new Map<string, FakeDeletedTree>();
  invitesByToken = new Map<string, InvitePreview & { treeId: string }>();
  /** How many more trees createTree allows before QUOTA_EXCEEDED. */
  quotaLeft = 3;
  /** Whether the signed-in user has two-step verification; createTree refuses without it. */
  twoFactorEnabled = true;
  /** The signed-in user's id, so permission checks can tell "members I invited" from others. */
  meUserId: string | null = null;
  calls: { method: Method; input: unknown }[] = [];
  private forced = new Map<Method, AuthError>();
  private pending = new Set<Method>();
  private waiting: (() => void)[] = [];
  private tokenCount = 0;

  /** Adds a tree (an owner view with every capability and one person by default); returns its id. */
  addTree(
    partial: {
      id?: string;
      name?: string;
      role?: TreeDetail['me']['role'];
      detail?: Partial<TreeDetail>;
      persons?: PersonSummary[];
      members?: Member[];
      stewards?: StewardGrant[];
      invites?: Invite[];
    } = {},
  ): string {
    const id = partial.id ?? crypto.randomUUID();
    const persons = partial.persons ?? [fakePerson()];
    const detail: TreeDetail = {
      tree: { id, name: partial.name ?? 'Lovelace family', rootPersonId: persons[0]?.id ?? null },
      me: {
        role: partial.role ?? 'owner',
        personId: null,
        steward: { grants: [], active: false },
      },
      capabilities: { editAnywhere: true, manageTree: true, invite: true, grantStewardship: true },
      ...partial.detail,
    };
    this.trees.set(id, {
      detail,
      persons,
      members: partial.members ?? [],
      stewards: partial.stewards ?? [],
      invites: partial.invites ?? [],
    });
    return id;
  }

  /** Adds an invite token the preview and accept calls recognise. */
  addInviteToken(token: string, preview: Partial<InvitePreview> & { treeId: string }) {
    this.invitesByToken.set(token, {
      treeName: 'Lovelace family',
      role: 'viewer',
      inviterName: 'Ada Lovelace',
      steward: false,
      targetPersonName: null,
      ...preview,
    });
  }

  /** The next call to `method` fails with this error. */
  failNext(method: Method, error: AuthError) {
    this.forced.set(method, error);
  }

  /** Calls to `method` wait until `release()` is called. */
  hold(method: Method) {
    this.pending.add(method);
  }

  release() {
    this.pending.clear();
    for (const resolve of this.waiting.splice(0)) resolve();
  }

  callsTo(method: Method) {
    return this.calls.filter((c) => c.method === method).map((c) => c.input);
  }

  private async enter(method: Method, input?: unknown): Promise<AuthError | null> {
    this.calls.push({ method, input });
    if (this.pending.has(method)) await new Promise<void>((r) => this.waiting.push(r));
    const forced = this.forced.get(method);
    if (forced) {
      this.forced.delete(method);
      return forced;
    }
    return null;
  }

  async listTrees() {
    const forced = await this.enter('listTrees');
    if (forced) return { ok: false as const, error: forced };
    const list: TreeList = {
      trees: [...this.trees.entries()].map(([id, t]) => ({
        id,
        name: t.detail.tree.name,
        role: t.detail.me.role,
      })),
      deletedTrees: [...this.deletedTrees.values()].map(
        ({ id, name, deletedAt, restoreUntil }) => ({ id, name, deletedAt, restoreUntil }),
      ),
    };
    return ok(list);
  }

  async createTree(input: CreateTreeInput) {
    const forced = await this.enter('createTree', input);
    if (forced) return { ok: false as const, error: forced };
    if (!this.twoFactorEnabled) return fail('TWO_FACTOR_REQUIRED', MESSAGES.twoFactorRequired);
    if (this.quotaLeft <= 0) return fail('QUOTA_EXCEEDED', MESSAGES.quota);
    this.quotaLeft -= 1;
    const person = fakePerson({
      givenName: input.person.givenName,
      surname: input.person.surname ?? null,
      birthYear: input.person.birthYear ?? null,
      deathYear: null,
      isLiving: true,
    });
    const id = this.addTree({ name: input.name, persons: [person] });
    return ok({ id });
  }

  private find(treeId: string): FakeTree | undefined {
    return this.trees.get(treeId);
  }

  async getTree(treeId: string) {
    const forced = await this.enter('getTree', treeId);
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    return t ? ok(t.detail) : notFound();
  }

  async updateTree(treeId: string, input: UpdateTreeInput) {
    const forced = await this.enter('updateTree', { treeId, input });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    if (!t.detail.capabilities.manageTree) return forbidden();
    if (input.name !== undefined) t.detail.tree.name = input.name;
    if (input.rootPersonId !== undefined) t.detail.tree.rootPersonId = input.rootPersonId;
    return ok(undefined);
  }

  async deleteTree(treeId: string) {
    const forced = await this.enter('deleteTree', treeId);
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    if (!t.detail.capabilities.manageTree) return forbidden();
    this.trees.delete(treeId);
    this.quotaLeft += 1;
    const now = Date.now();
    this.deletedTrees.set(treeId, {
      id: treeId,
      name: t.detail.tree.name,
      deletedAt: new Date(now).toISOString(),
      restoreUntil: new Date(now + 30 * 86_400_000).toISOString(),
      role: t.detail.me.role,
      tree: t,
    });
    return ok(undefined);
  }

  async restoreTree(treeId: string) {
    const forced = await this.enter('restoreTree', treeId);
    if (forced) return { ok: false as const, error: forced };
    const d = this.deletedTrees.get(treeId);
    if (!d || d.role !== 'owner') return notFound();
    if (this.quotaLeft <= 0) return fail('QUOTA_EXCEEDED', MESSAGES.quota);
    this.quotaLeft -= 1;
    this.deletedTrees.delete(treeId);
    this.trees.set(treeId, d.tree);
    return ok(undefined);
  }

  async listPersons(treeId: string) {
    const forced = await this.enter('listPersons', treeId);
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    return t ? ok([...t.persons]) : notFound();
  }

  async listMembers(treeId: string) {
    const forced = await this.enter('listMembers', treeId);
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    return t ? ok([...t.members]) : notFound();
  }

  /** Owners manage every non-owner; an active steward only the members they invited. */
  private mayManage(t: FakeTree, m: Member): boolean {
    if (m.role === 'owner') return false;
    if (t.detail.capabilities.manageTree) return true;
    return (
      t.detail.me.steward.active && this.meUserId !== null && m.invitedByUserId === this.meUserId
    );
  }

  async changeRole(treeId: string, userId: string, role: InviteRole) {
    const forced = await this.enter('changeRole', { treeId, userId, role });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    const m = t?.members.find((x) => x.userId === userId);
    if (!t || !m) return notFound();
    if (!this.mayManage(t, m)) return forbidden();
    m.role = role;
    return ok(undefined);
  }

  async removeMember(treeId: string, userId: string) {
    const forced = await this.enter('removeMember', { treeId, userId });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    const target = t?.members.find((x) => x.userId === userId);
    if (!t || !target) return notFound();
    if (!this.mayManage(t, target)) return forbidden();
    t.members = t.members.filter((x) => x.userId !== userId);
    t.stewards = t.stewards.filter((s) => s.userId !== userId);
    return ok(undefined);
  }

  async transferOwnership(treeId: string, userId: string) {
    const forced = await this.enter('transferOwnership', { treeId, userId });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    if (!t.detail.capabilities.manageTree) return forbidden();
    const target = t.members.find((x) => x.userId === userId);
    if (!target) return notFound();
    if (!target.twoFactorEnabled) {
      return fail('TWO_FACTOR_REQUIRED', MESSAGES.twoFactorRequired);
    }
    for (const m of t.members) if (m.role === 'owner') m.role = 'editor';
    target.role = 'owner';
    t.detail.me.role = 'editor';
    t.detail.capabilities = {
      editAnywhere: true,
      manageTree: false,
      invite: false,
      grantStewardship: false,
    };
    return ok(undefined);
  }

  async createResetLink(treeId: string, userId: string) {
    const forced = await this.enter('createResetLink', { treeId, userId });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    if (!t.detail.capabilities.manageTree) return forbidden();
    const m = t.members.find((x) => x.userId === userId);
    if (!m) return notFound();
    this.tokenCount += 1;
    const link: ResetLinkCreated = {
      token: `fake-reset-${this.tokenCount}`,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    return ok(link);
  }

  async listStewards(treeId: string) {
    const forced = await this.enter('listStewards', treeId);
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    return t ? ok([...t.stewards]) : notFound();
  }

  async grantSteward(treeId: string, input: { userId: string; anchorPersonId: string }) {
    const forced = await this.enter('grantSteward', { treeId, input });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    if (!t.detail.capabilities.grantStewardship) return forbidden();
    if (
      t.stewards.some((s) => s.userId === input.userId && s.anchorPersonId === input.anchorPersonId)
    ) {
      return fail('CONFLICT', MESSAGES.conflict);
    }
    const id = crypto.randomUUID();
    t.stewards.push({
      id,
      userId: input.userId,
      userName: t.members.find((m) => m.userId === input.userId)?.name ?? 'Member',
      anchorPersonId: input.anchorPersonId,
      grantedByUserId: null,
      grantedByName: null,
      parentGrantId: null,
      active: true,
    });
    return ok({ id });
  }

  async revokeSteward(treeId: string, grantId: string) {
    const forced = await this.enter('revokeSteward', { treeId, grantId });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t || !t.stewards.some((s) => s.id === grantId)) return notFound();
    t.stewards = t.stewards.filter((s) => s.id !== grantId && s.parentGrantId !== grantId);
    return ok(undefined);
  }

  async listInvites(treeId: string) {
    const forced = await this.enter('listInvites', treeId);
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    const caps = t.detail.capabilities;
    if (!caps.invite && !caps.manageTree) return forbidden();
    return ok([...t.invites]);
  }

  async createInvite(treeId: string, input: CreateInviteInput) {
    const forced = await this.enter('createInvite', { treeId, input });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    if (!t.detail.capabilities.invite) return forbidden();
    this.tokenCount += 1;
    const created: CreatedInvite = {
      id: crypto.randomUUID(),
      token: `fake-token-${this.tokenCount}`,
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    };
    t.invites.push({
      id: created.id,
      role: input.role,
      stewardAnchorPersonId: input.stewardAnchorPersonId ?? null,
      targetPersonId: input.targetPersonId ?? null,
      createdByUserId: crypto.randomUUID(),
      createdByName: 'You',
      expiresAt: created.expiresAt,
    });
    this.invitesByToken.set(created.token, {
      treeName: t.detail.tree.name,
      role: input.role,
      inviterName: 'You',
      steward: input.stewardAnchorPersonId != null,
      targetPersonName: null,
      treeId,
    });
    return ok(created);
  }

  async revokeInvite(treeId: string, inviteId: string) {
    const forced = await this.enter('revokeInvite', { treeId, inviteId });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t || !t.invites.some((i) => i.id === inviteId)) return notFound();
    t.invites = t.invites.filter((i) => i.id !== inviteId);
    return ok(undefined);
  }

  async previewInvite(token: string) {
    const forced = await this.enter('previewInvite', token);
    if (forced) return { ok: false as const, error: forced };
    const inv = this.invitesByToken.get(token);
    if (!inv) return fail('INVALID_INVITE', MESSAGES.invalidInvite);
    return ok<InvitePreview>({
      treeName: inv.treeName,
      role: inv.role,
      inviterName: inv.inviterName,
      steward: inv.steward,
      targetPersonName: inv.targetPersonName,
    });
  }

  async acceptInvite(token: string) {
    const forced = await this.enter('acceptInvite', token);
    if (forced) return { ok: false as const, error: forced };
    const inv = this.invitesByToken.get(token);
    if (!inv) return fail('INVALID_INVITE', MESSAGES.invalidInvite);
    this.invitesByToken.delete(token);
    return ok({ treeId: inv.treeId });
  }
}
