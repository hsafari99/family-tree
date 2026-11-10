import {
  type AddRelativeInput,
  type ChildKind,
  type CreatedInvite,
  type CreateInviteInput,
  type CreatePersonInput,
  type CreateTreeInput,
  type DeleteMode,
  type DeletePreview,
  type HistoryEntry,
  type Invite,
  type InvitePreview,
  type InviteRole,
  type Member,
  personConsistencyErrors,
  type PersonSummary,
  type PersonView,
  RESIDENCES_MAX,
  type ResetLinkCreated,
  type ResidenceInput,
  type StewardGrant,
  type TrashBatchDetail,
  type TreeDetail,
  type TreeList,
  unionDatesError,
  type UpdatePersonInput,
  type UpdateTreeInput,
  type UpdateUnionInput,
} from '@family-tree/shared';
import { personName } from '../trees/format';
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
  people: Map<string, PersonView>;
  history: Map<string, HistoryEntry[]>;
  previews: Map<string, DeletePreview>;
  trash: TrashBatchDetail[];
  /** Batch id -> the people the batch removed, so restore can put them back. */
  trashPeople: Map<string, PersonSummary[]>;
  /** Batch id -> views as they were before the batch, so restore can put relations back. */
  trashViews: Map<string, Map<string, PersonView>>;
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

/** A PersonView for a summary: version 1, everything else null or empty, every capability true. */
export function fakePersonView(
  summary: PersonSummary,
  partial: Partial<PersonView> = {},
): PersonView {
  return {
    person: {
      id: summary.id,
      givenName: summary.givenName,
      middleName: summary.middleName,
      surname: summary.surname,
      maidenName: null,
      nickname: null,
      sex: 'unknown',
      birthDate:
        summary.birthYear == null
          ? null
          : { qualifier: 'exact', date1: String(summary.birthYear).padStart(4, '0') },
      birthPlace: null,
      deathDate:
        summary.deathYear == null
          ? null
          : { qualifier: 'exact', date1: String(summary.deathYear).padStart(4, '0') },
      deathPlace: null,
      causeOfDeath: null,
      isLiving: summary.isLiving,
      occupation: null,
      education: null,
      biography: null,
      notes: null,
      version: 1,
      createdByName: null,
      updatedAt: new Date(0).toISOString(),
    },
    residences: [],
    relations: { parents: [], unions: [], siblings: [] },
    capabilities: { edit: true, addRelative: true, delete: true },
    ...partial,
  };
}

const yearOf = (d: { date1: string } | null | undefined): number | null =>
  d ? Number(d.date1.slice(0, 4)) : null;

/** An in-memory TreesApi. Tests can seed trees, force errors and inspect calls. */
export class FakeTreesApi implements TreesApi {
  trees = new Map<string, FakeTree>();
  deletedTrees = new Map<string, FakeDeletedTree>();
  invitesByToken = new Map<string, InvitePreview & { treeId: string }>();
  /** How many more trees createTree allows before QUOTA_EXCEEDED. */
  quotaLeft = 3;
  /** Whether the signed-in user has two-step verification; createTree refuses without it. */
  twoFactorEnabled = true;
  /** Trash batches whose restore fails with CONFLICT (the family changed since). */
  restoreConflicts = new Set<string>();
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
      people: new Map(),
      history: new Map(),
      previews: new Map(),
      trash: [],
      trashPeople: new Map(),
      trashViews: new Map(),
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

  // ---- people, relations, residences, deletion and Trash ----
  // Permissions mirror the real API: editors and owners edit anywhere, a viewer never edits,
  // an active steward acts inside a branch (the fake can't compute scope, so it allows it);
  // only the owner or a steward may delete; the Trash is owner-only.

  private mayEdit(t: FakeTree): boolean {
    return t.detail.capabilities.editAnywhere || t.detail.me.steward.active;
  }

  private mayDelete(t: FakeTree): boolean {
    return t.detail.capabilities.manageTree || t.detail.me.steward.active;
  }

  private viewOf(t: FakeTree, personId: string): PersonView | undefined {
    const stored = t.people.get(personId);
    if (stored) return stored;
    const summary = t.persons.find((p) => p.id === personId);
    if (!summary) return undefined;
    const view = fakePersonView(summary, {
      capabilities: {
        edit: this.mayEdit(t),
        addRelative: this.mayEdit(t),
        delete: this.mayDelete(t),
      },
    });
    t.people.set(personId, view);
    return view;
  }

  private views(t: FakeTree): PersonView[] {
    return t.persons.flatMap((p) => this.viewOf(t, p.id) ?? []);
  }

  private personNotFound = () => fail('NOT_FOUND', MESSAGES.personNotFound);
  private invalid = () => fail('VALIDATION', MESSAGES.checkDetails);

  async getPerson(treeId: string, personId: string) {
    const forced = await this.enter('getPerson', { treeId, personId });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    const view = this.viewOf(t, personId);
    return view ? ok(structuredClone(view)) : this.personNotFound();
  }

  async createPerson(treeId: string, input: CreatePersonInput) {
    const forced = await this.enter('createPerson', { treeId, input });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    if (!this.mayEdit(t)) return forbidden();
    const f = input.person;
    if (!f.givenName.trim()) return this.invalid();
    if (input.attach && !t.persons.some((p) => p.id === input.attach!.to)) return this.invalid();
    const view = fakePersonView(
      fakePerson({
        givenName: f.givenName.trim(),
        middleName: f.middleName ?? null,
        surname: f.surname ?? null,
        birthYear: yearOf(f.birthDate),
        deathYear: yearOf(f.deathDate),
        isLiving: f.isLiving ?? !(f.deathDate || f.deathPlace || f.causeOfDeath),
      }),
      { capabilities: { edit: true, addRelative: true, delete: this.mayDelete(t) } },
    );
    Object.assign(view.person, {
      sex: f.sex ?? 'unknown',
      birthDate: f.birthDate ?? null,
      deathDate: f.deathDate ?? null,
    });
    t.persons.push({
      id: view.person.id,
      givenName: view.person.givenName,
      middleName: view.person.middleName,
      surname: view.person.surname,
      birthYear: yearOf(view.person.birthDate),
      deathYear: yearOf(view.person.deathDate),
      isLiving: view.person.isLiving,
    });
    t.people.set(view.person.id, view);
    return ok({ id: view.person.id });
  }

  async updatePerson(treeId: string, personId: string, input: UpdatePersonInput) {
    const forced = await this.enter('updatePerson', { treeId, personId, input });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    const view = this.viewOf(t, personId);
    if (!view) return this.personNotFound();
    if (!this.mayEdit(t) || !view.capabilities.edit) return forbidden();
    const { version, ...fields } = input;
    if (version !== view.person.version) return fail('CONFLICT', MESSAGES.staleEdit);
    const changed = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const merged = { ...view.person, ...changed };
    if (Object.keys(personConsistencyErrors(merged)).length > 0) return this.invalid();
    Object.assign(view.person, merged, { version: view.person.version + 1 });
    const summary = t.persons.find((p) => p.id === personId);
    if (summary) {
      Object.assign(summary, {
        givenName: merged.givenName,
        middleName: merged.middleName,
        surname: merged.surname,
        birthYear: yearOf(merged.birthDate),
        deathYear: yearOf(merged.deathDate),
        isLiving: merged.isLiving,
      });
    }
    return ok({ version: view.person.version });
  }

  async addRelative(treeId: string, personId: string, input: AddRelativeInput) {
    const forced = await this.enter('addRelative', { treeId, personId, input });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    if (!this.viewOf(t, personId)) return this.personNotFound();
    if (!t.persons.some((p) => p.id === input.personId) || input.personId === personId) {
      return this.invalid();
    }
    if (!this.mayEdit(t)) return forbidden();
    const subject = this.viewOf(t, personId)!;
    if (
      input.as === 'partner' &&
      subject.relations.unions.some((u) => u.partner?.id === input.personId)
    ) {
      return fail('CONFLICT', MESSAGES.alreadyRelated);
    }
    return ok(undefined);
  }

  private findUnion(t: FakeTree, unionId: string) {
    for (const v of this.views(t)) {
      const u = v.relations.unions.find((x) => x.id === unionId);
      if (u) return u;
    }
    return undefined;
  }

  async updateUnion(treeId: string, unionId: string, input: UpdateUnionInput) {
    const forced = await this.enter('updateUnion', { treeId, unionId, input });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    if (!this.findUnion(t, unionId)) return notFound();
    if (!this.mayEdit(t)) return forbidden();
    const given = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const merged = { ...this.findUnion(t, unionId)!, ...given };
    if (unionDatesError(merged)) return this.invalid();
    for (const v of this.views(t)) {
      for (const u of v.relations.unions) if (u.id === unionId) Object.assign(u, given);
      for (const p of v.relations.parents) {
        if (p.union.id === unionId) Object.assign(p.union, given);
      }
    }
    return ok(undefined);
  }

  async updateParentChild(treeId: string, linkId: string, input: { kind: ChildKind }) {
    const forced = await this.enter('updateParentChild', { treeId, linkId, input });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    let found = false;
    for (const v of this.views(t)) {
      for (const p of v.relations.parents) if (p.linkId === linkId) found = true;
      for (const u of v.relations.unions) {
        for (const c of u.children) if (c.linkId === linkId) found = true;
      }
    }
    if (!found) return notFound();
    if (!this.mayEdit(t)) return forbidden();
    for (const v of this.views(t)) {
      for (const p of v.relations.parents) if (p.linkId === linkId) p.kind = input.kind;
      for (const u of v.relations.unions) {
        for (const c of u.children) if (c.linkId === linkId) c.kind = input.kind;
      }
    }
    return ok(undefined);
  }

  private snapshot(t: FakeTree): Map<string, PersonView> {
    return new Map(this.views(t).map((v) => [v.person.id, structuredClone(v)]));
  }

  private pushRelationBatch(
    t: FakeTree,
    root: TrashBatchDetail['batch']['root'],
    counts: { unions: number; links: number },
    before: Map<string, PersonView>,
  ) {
    const batchId = crypto.randomUUID();
    t.trash.push({
      batch: {
        id: batchId,
        mode: 'relation',
        createdAt: new Date().toISOString(),
        deletedBy: null,
        root,
        people: 0,
        ...counts,
      },
      people: [],
      unions: [],
      links: [],
      slots: 0,
    });
    t.trashViews.set(batchId, before);
    return batchId;
  }

  async deleteUnion(treeId: string, unionId: string) {
    const forced = await this.enter('deleteUnion', { treeId, unionId });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    const union = this.findUnion(t, unionId);
    if (!union) return notFound();
    if (!this.mayDelete(t)) return forbidden();
    const before = this.snapshot(t);
    const partners = this.views(t)
      .filter((v) => v.relations.unions.some((u) => u.id === unionId))
      .map((v) => personName(v.person));
    for (const v of this.views(t)) {
      v.relations.unions = v.relations.unions.filter((u) => u.id !== unionId);
      v.relations.parents = v.relations.parents.filter((p) => p.union.id !== unionId);
      v.relations.siblings = v.relations.siblings.filter((s) => s.unionId !== unionId);
    }
    const batchId = this.pushRelationBatch(
      t,
      { kind: 'union', partners },
      { unions: 1, links: union.children.length },
      before,
    );
    return ok({ batchId });
  }

  async deleteParentChild(treeId: string, linkId: string) {
    const forced = await this.enter('deleteParentChild', { treeId, linkId });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    const child = this.views(t).find((v) => v.relations.parents.some((p) => p.linkId === linkId));
    const asChild = this.views(t)
      .flatMap((v) => v.relations.unions)
      .some((u) => u.children.some((c) => c.linkId === linkId));
    if (!child && !asChild) return notFound();
    if (!this.mayDelete(t)) return forbidden();
    const before = this.snapshot(t);
    const link = child?.relations.parents.find((p) => p.linkId === linkId);
    for (const v of this.views(t)) {
      v.relations.parents = v.relations.parents.filter((p) => p.linkId !== linkId);
      for (const u of v.relations.unions) {
        u.children = u.children.filter((c) => c.linkId !== linkId);
      }
    }
    const batchId = this.pushRelationBatch(
      t,
      {
        kind: 'link',
        child: child ? personName(child.person) : null,
        parents: (link?.parents ?? []).map(personName),
      },
      { unions: 0, links: 1 },
      before,
    );
    return ok({ batchId });
  }

  private findResidence(t: FakeTree, residenceId: string) {
    for (const v of this.views(t)) {
      const r = v.residences.find((x) => x.id === residenceId);
      if (r) return { view: v, residence: r };
    }
    return undefined;
  }

  async addResidence(treeId: string, personId: string, input: ResidenceInput) {
    const forced = await this.enter('addResidence', { treeId, personId, input });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    const view = this.viewOf(t, personId);
    if (!view) return this.personNotFound();
    if (!this.mayEdit(t) || !view.capabilities.edit) return forbidden();
    if (!input.place.trim() || view.residences.length >= RESIDENCES_MAX) return this.invalid();
    const id = crypto.randomUUID();
    view.residences.push({
      id,
      place: input.place.trim(),
      fromDate: input.fromDate ?? null,
      toDate: input.toDate ?? null,
    });
    return ok({ id });
  }

  async updateResidence(treeId: string, residenceId: string, input: ResidenceInput) {
    const forced = await this.enter('updateResidence', { treeId, residenceId, input });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    const found = this.findResidence(t, residenceId);
    if (!found) return notFound();
    if (!this.mayEdit(t) || !found.view.capabilities.edit) return forbidden();
    if (!input.place.trim()) return this.invalid();
    Object.assign(found.residence, {
      place: input.place.trim(),
      fromDate: input.fromDate ?? null,
      toDate: input.toDate ?? null,
    });
    return ok(undefined);
  }

  async deleteResidence(treeId: string, residenceId: string) {
    const forced = await this.enter('deleteResidence', { treeId, residenceId });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    const found = this.findResidence(t, residenceId);
    if (!found) return notFound();
    if (!this.mayEdit(t) || !found.view.capabilities.edit) return forbidden();
    found.view.residences = found.view.residences.filter((r) => r.id !== residenceId);
    return ok(undefined);
  }

  async previewDelete(treeId: string, personId: string, mode: DeleteMode) {
    const forced = await this.enter('previewDelete', { treeId, personId, mode });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    const summary = t.persons.find((p) => p.id === personId);
    if (!summary) return this.personNotFound();
    if (!this.mayDelete(t)) return forbidden();
    const blockedByRoot = personId === t.detail.tree.rootPersonId;
    return ok<DeletePreview>(
      t.previews.get(`${personId}:${mode}`) ??
        t.previews.get(personId) ?? {
          mode,
          people: [summary],
          unions: 0,
          links: 0,
          outsideScope: 0,
          blockedByRoot,
          allowed: !blockedByRoot,
        },
    );
  }

  async deletePerson(treeId: string, personId: string, mode: DeleteMode) {
    const forced = await this.enter('deletePerson', { treeId, personId, mode });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    const summary = t.persons.find((p) => p.id === personId);
    if (!summary) return this.personNotFound();
    if (!this.mayDelete(t)) return fail('FORBIDDEN', MESSAGES.deleteNotAllowed);
    const preview = t.previews.get(`${personId}:${mode}`) ??
      t.previews.get(personId) ?? {
        mode,
        people: [summary],
        unions: 0,
        links: 0,
        outsideScope: 0,
        blockedByRoot: personId === t.detail.tree.rootPersonId,
        allowed: personId !== t.detail.tree.rootPersonId,
      };
    if (preview.blockedByRoot || preview.people.some((p) => p.id === t.detail.tree.rootPersonId)) {
      return this.invalid();
    }
    // A steward may not delete people outside their branch (the preview says so).
    if (!preview.allowed || (!t.detail.capabilities.manageTree && preview.outsideScope > 0)) {
      return fail('FORBIDDEN', MESSAGES.deleteNotAllowed);
    }
    const batchId = crypto.randomUUID();
    const before = this.snapshot(t);
    const ids = new Set(preview.people.map((p) => p.id));
    const removed = t.persons.filter((p) => ids.has(p.id));
    t.persons = t.persons.filter((p) => !ids.has(p.id));
    for (const id of ids) t.people.delete(id);
    t.trashPeople.set(batchId, removed);
    t.trashViews.set(batchId, before);
    t.trash.push({
      batch: {
        id: batchId,
        mode,
        createdAt: new Date().toISOString(),
        deletedBy: null,
        root: { kind: 'person', name: personName(summary) },
        people: removed.length,
        unions: preview.unions,
        links: preview.links,
      },
      people: removed,
      unions: [],
      links: [],
      slots: 0,
    });
    return ok({ batchId });
  }

  async personHistory(treeId: string, personId: string) {
    const forced = await this.enter('personHistory', { treeId, personId });
    if (forced) return { ok: false as const, error: forced };
    const t = this.find(treeId);
    if (!t) return notFound();
    if (!t.persons.some((p) => p.id === personId)) return this.personNotFound();
    return ok([...(t.history.get(personId) ?? [])]);
  }

  private trashAccess(treeId: string): { t: FakeTree } | { error: Result<never> } {
    const t = this.find(treeId);
    if (!t) return { error: notFound() };
    if (!t.detail.capabilities.manageTree) {
      return { error: fail('FORBIDDEN', MESSAGES.trashOwnerOnly) };
    }
    return { t };
  }

  async listTrash(treeId: string) {
    const forced = await this.enter('listTrash', treeId);
    if (forced) return { ok: false as const, error: forced };
    const a = this.trashAccess(treeId);
    return 'error' in a ? a.error : ok(a.t.trash.map((e) => e.batch));
  }

  async getTrashBatch(treeId: string, batchId: string) {
    const forced = await this.enter('getTrashBatch', { treeId, batchId });
    if (forced) return { ok: false as const, error: forced };
    const a = this.trashAccess(treeId);
    if ('error' in a) return a.error;
    const entry = a.t.trash.find((e) => e.batch.id === batchId);
    return entry ? ok(entry) : fail('NOT_FOUND', MESSAGES.itemGone);
  }

  async restoreBatch(treeId: string, batchId: string) {
    const forced = await this.enter('restoreBatch', { treeId, batchId });
    if (forced) return { ok: false as const, error: forced };
    const a = this.trashAccess(treeId);
    if ('error' in a) return a.error;
    const t = a.t;
    if (!t.trash.some((e) => e.batch.id === batchId)) return fail('NOT_FOUND', MESSAGES.itemGone);
    if (this.restoreConflicts.has(batchId)) return fail('CONFLICT', MESSAGES.restoreConflict);
    t.persons.push(...(t.trashPeople.get(batchId) ?? []));
    for (const [id, before] of t.trashViews.get(batchId) ?? []) {
      const now = t.people.get(id);
      if (now) now.relations = before.relations;
      else if (t.persons.some((p) => p.id === id)) t.people.set(id, before);
    }
    t.trash = t.trash.filter((e) => e.batch.id !== batchId);
    t.trashPeople.delete(batchId);
    t.trashViews.delete(batchId);
    return ok(undefined);
  }

  async eraseBatch(treeId: string, batchId: string) {
    const forced = await this.enter('eraseBatch', { treeId, batchId });
    if (forced) return { ok: false as const, error: forced };
    const a = this.trashAccess(treeId);
    if ('error' in a) return a.error;
    const t = a.t;
    if (!t.trash.some((e) => e.batch.id === batchId)) return fail('NOT_FOUND', MESSAGES.itemGone);
    t.trash = t.trash.filter((e) => e.batch.id !== batchId);
    t.trashPeople.delete(batchId);
    t.trashViews.delete(batchId);
    return ok(undefined);
  }
}
