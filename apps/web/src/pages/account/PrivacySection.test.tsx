import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeAuthApi } from '../../test/fake-auth';
import { FakeTreesApi, fakePerson } from '../../test/fake-trees';
import { renderAt } from '../../test/render';

function setup() {
  const auth = new FakeAuthApi();
  auth.addUser({ email: 'a@example.com', name: 'Ada' }, { signedIn: true });
  const trees = new FakeTreesApi();
  const me = fakePerson({ givenName: 'Ada' });
  const linked = trees.addTree({ name: 'King family', persons: [me] });
  trees.trees.get(linked)!.detail.me.personId = me.id;
  const unlinked = trees.addTree({ name: 'Byron family' });
  trees.trees.get(unlinked)!.detail.me.personId = null;
  return { auth, trees, linked };
}

describe('Account > Privacy', () => {
  it('saves who can see my details, per tree', async () => {
    const s = setup();
    renderAt('/account/privacy', s);
    const king = await screen.findByRole('region', { name: 'King family' });
    expect(
      await within(king).findByLabelText('Everyone in this tree and linked trees'),
    ).toBeChecked();

    fireEvent.click(within(king).getByLabelText('My branch'));
    fireEvent.change(within(king).getByLabelText('How close'), { target: { value: '3' } });
    fireEvent.click(within(king).getByLabelText('Show my birthday but hide the year'));
    fireEvent.click(within(king).getByRole('button', { name: 'Save privacy' }));

    expect(await within(king).findByText('Privacy saved')).toBeInTheDocument();
    expect(s.trees.callsTo('setMyPrivacy')).toEqual([
      { treeId: s.linked, settings: { level: 'branch', steps: 3, hideBirthYear: true } },
    ]);
  });

  it('explains that a tree I’m not linked in has nothing to hide', async () => {
    renderAt('/account/privacy', setup());
    const byron = await screen.findByRole('region', { name: 'Byron family' });
    expect(
      await within(byron).findByText(/aren’t linked to a person in this tree/),
    ).toBeInTheDocument();
    expect(within(byron).queryByRole('button', { name: 'Save privacy' })).toBeNull();
  });
});
