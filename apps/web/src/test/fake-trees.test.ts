import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../auth/api';
import { FakeTreesApi, fakePerson } from './fake-trees';

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
