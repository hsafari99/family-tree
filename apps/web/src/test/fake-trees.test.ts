import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../auth/api';
import { haleGraph } from '../canvas/test-fixtures';
import { FakeTreesApi, fakeGraph, fakeGraphPerson, fakePerson } from './fake-trees';

const viewerCaps = {
  editAnywhere: false,
  manageTree: false,
  invite: false,
  grantStewardship: false,
};
const id = () => crypto.randomUUID();

function viewerTree() {
  const trees = new FakeTreesApi();
  const treeId = trees.addTree({ role: 'viewer', detail: { capabilities: viewerCaps } });
  return { trees, treeId };
}

describe('FakeTreesApi refuses what the real API refuses', () => {
  it.each([
    ['updateTree', (t: FakeTreesApi, i: string) => t.updateTree(i, { name: 'x' })],
    ['deleteTree', (t: FakeTreesApi, i: string) => t.deleteTree(i)],
    ['transferOwnership', (t: FakeTreesApi, i: string) => t.transferOwnership(i, id())],
    ['createResetLink', (t: FakeTreesApi, i: string) => t.createResetLink(i, id())],
    ['listInvites', (t: FakeTreesApi, i: string) => t.listInvites(i)],
    ['createInvite', (t: FakeTreesApi, i: string) => t.createInvite(i, { role: 'viewer' })],
    [
      'grantSteward',
      (t: FakeTreesApi, i: string) => t.grantSteward(i, { userId: id(), anchorPersonId: id() }),
    ],
  ])('%s returns FORBIDDEN without the capability', async (_name, call) => {
    const { trees, treeId } = viewerTree();
    expect(await call(trees, treeId)).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: MESSAGES.forbidden },
    });
  });

  it('restoreTree by a non-owner is NOT_FOUND, and respects the quota', async () => {
    const trees = new FakeTreesApi();
    const mine = trees.addTree({ role: 'owner' });
    const theirs = trees.addTree({ role: 'editor' });
    await trees.deleteTree(mine);
    trees.deletedTrees.set(theirs, {
      id: theirs,
      name: 'x',
      deletedAt: '',
      restoreUntil: '',
      role: 'editor',
      tree: trees.trees.get(theirs)!,
    });
    trees.trees.delete(theirs);
    const res = await trees.restoreTree(theirs);
    expect(res).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    trees.quotaLeft = 0;
    expect(await trees.restoreTree(mine)).toMatchObject({
      ok: false,
      error: { code: 'QUOTA_EXCEEDED', message: MESSAGES.quota },
    });
  });

  it('createTree needs two-step verification', async () => {
    const trees = new FakeTreesApi();
    trees.twoFactorEnabled = false;
    expect(await trees.createTree({ name: 'x', person: { givenName: 'a' } })).toMatchObject({
      ok: false,
      error: { code: 'TWO_FACTOR_REQUIRED', message: MESSAGES.twoFactorRequired },
    });
  });

  it('changeRole and removeMember need permission over that member', async () => {
    const { trees, treeId } = viewerTree();
    const userId = id();
    trees.trees.get(treeId)!.members.push({
      userId,
      name: 'X',
      role: 'viewer',
      personId: null,
      invitedByUserId: null,
    });
    const forbidden = { ok: false, error: { code: 'FORBIDDEN', message: MESSAGES.forbidden } };
    expect(await trees.changeRole(treeId, userId, 'editor')).toEqual(forbidden);
    expect(await trees.removeMember(treeId, userId)).toEqual(forbidden);
  });

  it('transferOwnership rejects a target without two-step verification', async () => {
    const trees = new FakeTreesApi();
    const treeId = trees.addTree();
    const userId = id();
    trees.trees.get(treeId)!.members.push({
      userId,
      name: 'X',
      role: 'editor',
      personId: null,
      invitedByUserId: null,
      twoFactorEnabled: false,
    });
    expect(await trees.transferOwnership(treeId, userId)).toMatchObject({
      ok: false,
      error: { code: 'TWO_FACTOR_REQUIRED', message: MESSAGES.twoFactorRequired },
    });
  });

  it('updatePerson with a stale version is a CONFLICT, and a viewer is FORBIDDEN', async () => {
    const trees = new FakeTreesApi();
    const p = fakePerson();
    const treeId = trees.addTree({ persons: [p] });
    expect(await trees.updatePerson(treeId, p.id, { version: 1, givenName: 'B' })).toEqual({
      ok: true,
      data: { version: 2 },
    });
    expect(await trees.updatePerson(treeId, p.id, { version: 1, givenName: 'C' })).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', message: MESSAGES.staleEdit },
    });
    const v = viewerTree();
    const vp = v.trees.trees.get(v.treeId)!.persons[0]!;
    expect(
      await v.trees.updatePerson(v.treeId, vp.id, { version: 1, givenName: 'x' }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await v.trees.createPerson(v.treeId, { person: { givenName: 'x' } })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('deletePerson moves a person to the Trash and restoreBatch brings them back', async () => {
    const trees = new FakeTreesApi();
    const root = fakePerson();
    const p = fakePerson({ givenName: 'Bob' });
    const treeId = trees.addTree({ persons: [root, p] });
    const del = await trees.deletePerson(treeId, p.id, 'person');
    if (!del.ok) throw new Error('expected ok');
    expect(trees.trees.get(treeId)!.persons.map((x) => x.id)).toEqual([root.id]);
    const list = await trees.listTrash(treeId);
    expect(list.ok && list.data).toHaveLength(1);
    expect(await trees.restoreBatch(treeId, del.data.batchId)).toEqual({
      ok: true,
      data: undefined,
    });
    expect(trees.trees.get(treeId)!.persons.map((x) => x.id)).toContain(p.id);
    expect(await trees.listTrash(treeId)).toEqual({ ok: true, data: [] });
  });

  it('refuses deleting the root person, and deletes by editors and viewers', async () => {
    const trees = new FakeTreesApi();
    const root = fakePerson();
    const treeId = trees.addTree({ persons: [root] });
    expect(await trees.deletePerson(treeId, root.id, 'person')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    const editorCaps = { ...viewerCaps, editAnywhere: true };
    const ed = new FakeTreesApi();
    const a = fakePerson();
    const b = fakePerson();
    const et = ed.addTree({
      role: 'editor',
      persons: [a, b],
      detail: { capabilities: editorCaps },
    });
    expect(await ed.deletePerson(et, b.id, 'person')).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', message: MESSAGES.deleteNotAllowed },
    });
    expect(await ed.previewDelete(et, b.id, 'person')).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('Trash is owner-only and restore can conflict', async () => {
    const v = viewerTree();
    for (const r of [
      await v.trees.listTrash(v.treeId),
      await v.trees.getTrashBatch(v.treeId, id()),
    ]) {
      expect(r).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN', message: MESSAGES.trashOwnerOnly },
      });
    }
    expect(await v.trees.restoreBatch(v.treeId, id())).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(await v.trees.eraseBatch(v.treeId, id())).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    const trees = new FakeTreesApi();
    const p = fakePerson();
    const treeId = trees.addTree({ persons: [fakePerson(), p] });
    const del = await trees.deletePerson(treeId, p.id, 'person');
    if (!del.ok) throw new Error('expected ok');
    trees.restoreConflicts.add(del.data.batchId);
    expect(await trees.restoreBatch(treeId, del.data.batchId)).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', message: MESSAGES.restoreConflict },
    });
    expect(trees.trees.get(treeId)!.trash).toHaveLength(1);
  });
});

describe('FakeTreesApi graph, similar and child-order', () => {
  it('getGraph without a seeded graph returns every person, no unions', async () => {
    const trees = new FakeTreesApi();
    const a = fakePerson();
    const b = fakePerson({ givenName: 'Byron' });
    const treeId = trees.addTree({ persons: [a, b] });
    const res = await trees.getGraph(treeId, {});
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.persons.map((p) => p.id)).toEqual([a.id, b.id]);
    expect(res.data.unions).toEqual([]);
    expect(res.data.focusId).toBe(a.id);
    expect(res.data.persons.every((p) => p.canAddRelative)).toBe(true);
    const viewer = trees.addTree({ role: 'viewer', detail: { capabilities: viewerCaps } });
    const v = await trees.getGraph(viewer, { mode: 'full' });
    if (!v.ok) throw new Error('expected ok');
    expect(v.data.focusId).toBeNull();
    expect(v.data.persons.every((p) => !p.canAddRelative)).toBe(true);
    expect(await trees.getGraph('nope', {})).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('findSimilar finds Ada Lovelace for a lower-case first name', async () => {
    const trees = new FakeTreesApi();
    const ada = fakePerson();
    const treeId = trees.addTree({
      persons: [ada, fakePerson({ givenName: 'Zed', surname: 'Q' })],
    });
    const res = await trees.findSimilar(treeId, { givenName: 'ada' });
    expect(res).toEqual({ ok: true, data: [ada] });
  });

  it('listDisconnected returns the seeded list', async () => {
    const trees = new FakeTreesApi();
    const treeId = trees.addTree();
    const p = fakePerson();
    trees.trees.get(treeId)!.disconnected = [p];
    expect(await trees.listDisconnected(treeId)).toEqual({ ok: true, data: [p] });
  });

  describe('reorderChildren', () => {
    function seeded(role: 'owner' | 'viewer' = 'owner') {
      const trees = new FakeTreesApi();
      const [d, l, a, b] = [
        fakePerson({ givenName: 'David' }),
        fakePerson({ givenName: 'Laura' }),
        fakePerson({ givenName: 'Leo' }),
        fakePerson({ givenName: 'Mia' }),
      ];
      const treeId = trees.addTree({
        persons: [d, l, a, b],
        ...(role === 'viewer' ? { role, detail: { capabilities: viewerCaps } } : {}),
      });
      const t = trees.trees.get(treeId)!;
      t.graph = fakeGraph(
        [d, l, a, b].map((p) => fakeGraphPerson(p)),
        {
          unions: [
            {
              id: 'u1',
              partnerAId: d.id,
              partnerBId: l.id,
              type: 'marriage',
              status: 'married',
              startDate: null,
              endDate: null,
              childCount: 2,
              canEdit: true,
            },
          ],
          links: [
            { id: 'k1', unionId: 'u1', childId: a.id, kind: 'biological' },
            { id: 'k2', unionId: 'u1', childId: b.id, kind: 'biological' },
          ],
        },
      );
      return { trees, treeId, t, a, b };
    }

    it('sets siblingOrder in the seeded graph', async () => {
      const { trees, treeId, t, a, b } = seeded();
      expect(await trees.reorderChildren(treeId, 'u1', [b.id, a.id])).toEqual({
        ok: true,
        data: undefined,
      });
      const order = (id: string) => t.graph!.persons.find((p) => p.id === id)!.siblingOrder;
      expect([order(b.id), order(a.id)]).toEqual([1, 2]);
    });

    it('refuses a viewer, an unknown union and a different set of children', async () => {
      const v = seeded('viewer');
      expect(await v.trees.reorderChildren(v.treeId, 'u1', [v.b.id, v.a.id])).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
      const { trees, treeId, a } = seeded();
      expect(await trees.reorderChildren(treeId, 'nope', [a.id, a.id])).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
      expect(await trees.reorderChildren(treeId, 'u1', [a.id, crypto.randomUUID()])).toMatchObject({
        ok: false,
        error: { code: 'CONFLICT', message: MESSAGES.itemChanged },
      });
    });
  });
});

describe('FakeTreesApi photos, search and relationships', () => {
  const png = (size = 1000) => {
    const b = new Blob(['x'], { type: 'image/png' });
    return Object.defineProperty(b, 'size', { value: size });
  };

  function one(role: 'owner' | 'viewer' = 'owner') {
    const trees = new FakeTreesApi();
    const ada = fakePerson({ givenName: 'Ada' });
    const treeId = trees.addTree({
      persons: [ada],
      role,
      ...(role === 'viewer' ? { detail: { capabilities: viewerCaps } } : {}),
    });
    return { trees, treeId, ada };
  }

  it('uploads, moves the main photo and promotes on delete', async () => {
    const { trees, treeId, ada } = one();
    const a = await trees.uploadPhoto(treeId, ada.id, png());
    const b = await trees.uploadPhoto(treeId, ada.id, png());
    if (!a.ok || !b.ok) throw new Error('upload failed');
    expect(a.data.photo.isPrimary).toBe(true);
    expect(b.data.photo.isPrimary).toBe(false);
    expect(b.data.usage.usedBytes).toBe(100_000);
    await trees.setPrimaryPhoto(treeId, b.data.photo.id);
    let view = await trees.getPerson(treeId, ada.id);
    expect(view.ok && view.data.photos.find((p) => p.isPrimary)?.id).toBe(b.data.photo.id);
    await trees.deletePhoto(treeId, b.data.photo.id);
    view = await trees.getPerson(treeId, ada.id);
    expect(view.ok && view.data.photos.map((p) => [p.id, p.isPrimary])).toEqual([
      [a.data.photo.id, true],
    ]);
    expect(view.ok && view.data.photoUsage.usedBytes).toBe(50_000);
  });

  it('refuses bad types, big files, quota overflow, viewers and unknown people', async () => {
    const { trees, treeId, ada } = one();
    const gif = new Blob(['x'], { type: 'image/gif' });
    expect(await trees.uploadPhoto(treeId, ada.id, gif)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', message: MESSAGES.photoType },
    });
    expect(await trees.uploadPhoto(treeId, ada.id, png(10 * 1024 * 1024 + 1))).toMatchObject({
      ok: false,
      error: { message: MESSAGES.photoTooLarge },
    });
    trees.trees.get(treeId)!.photoLimit = 60_000;
    await trees.uploadPhoto(treeId, ada.id, png());
    expect(await trees.uploadPhoto(treeId, ada.id, png())).toMatchObject({
      ok: false,
      error: { code: 'QUOTA_EXCEEDED', message: MESSAGES.photoQuota },
    });
    expect(await trees.uploadPhoto(treeId, 'nobody', png())).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    const v = one('viewer');
    expect(await v.trees.uploadPhoto(v.treeId, v.ada.id, png())).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(trees.callsTo('uploadPhoto')[0]).toMatchObject({ type: 'image/gif', size: 1 });
  });

  it('sets the thumbnail on the graph person', async () => {
    const { trees, treeId, ada } = one();
    trees.trees.get(treeId)!.graph = fakeGraph([fakeGraphPerson(ada)]);
    await trees.uploadPhoto(treeId, ada.id, png());
    const g = await trees.getGraph(treeId, {});
    expect(g.ok && g.data.persons[0]!.photoThumbUrl).toMatch(/^https:\/\/photos\.test\//);
  });

  function hale() {
    const trees = new FakeTreesApi();
    const g = haleGraph();
    const treeId = trees.addTree({
      persons: g.persons.map(
        ({ id, givenName, middleName, surname, birthYear, deathYear, isLiving }) => ({
          id,
          givenName,
          middleName,
          surname,
          birthYear,
          deathYear,
          isLiving,
        }),
      ),
      detail: { me: { role: 'owner', personId: 'leo', steward: { grants: [], active: false } } },
    });
    trees.trees.get(treeId)!.graph = g;
    return { trees, treeId };
  }

  it('searches by words, years and status, and relates results to me', async () => {
    const { trees, treeId } = hale();
    const r = await trees.search(treeId, { q: 'lau' });
    expect(r.ok && r.data.map((x) => x.givenName)).toEqual(['Laura']);
    expect(r.ok && r.data[0]!.relation).toMatchObject([{ move: 'parent', personId: 'laura' }]);
    const me = await trees.search(treeId, { q: 'leo' });
    expect(me.ok && me.data[0]!.relation).toEqual([]);
    const born = await trees.search(treeId, { bornFrom: 1990, bornTo: 1999 });
    expect(born.ok && born.data.map((x) => x.givenName)).toContain('Leo');
    const dead = await trees.search(treeId, { status: 'deceased' });
    expect(dead.ok && dead.data.every((x) => !x.isLiving)).toBe(true);
    await trees.search(treeId, { q: 'x', place: 'Leeds', branch: 'leo' });
    expect(trees.callsTo('search').at(-1)).toMatchObject({
      query: { place: 'Leeds', branch: 'leo' },
    });
  });

  it('finds a relationship path over the graph', async () => {
    const { trees, treeId } = hale();
    const r = await trees.relationship(treeId, 'leo', 'laura');
    expect(r.ok && r.data.steps).toMatchObject([{ move: 'parent', personId: 'laura' }]);
    expect(r.ok && r.data.persons.map((p) => p.id)).toEqual(['leo', 'laura']);
    expect(await trees.relationship(treeId, 'leo', 'nobody')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});
