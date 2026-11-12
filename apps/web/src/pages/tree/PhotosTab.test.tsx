import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../auth/api';
import { FakeAuthApi } from '../../test/fake-auth';
import { FakeTreesApi, fakePerson, fakePersonView } from '../../test/fake-trees';
import { renderAt } from '../../test/render';

vi.mock('../../photos/crop', async (orig) => ({
  ...(await orig<typeof import('../../photos/crop')>()),
  cropToBlob: vi.fn(async (f: Blob, box: unknown) =>
    box ? new Blob(['crop'], { type: 'image/jpeg' }) : f,
  ),
}));
import { cropToBlob } from '../../photos/crop';
import { PhotoCropper } from '../../photos/PhotoCropper';

const ada = fakePerson({ givenName: 'Ada', surname: 'King' });
const viewerCaps = {
  editAnywhere: false,
  manageTree: false,
  invite: false,
  grantStewardship: false,
};

function setup(role: 'owner' | 'viewer' = 'owner', photos = 0) {
  const auth = new FakeAuthApi();
  auth.addUser({ email: 'a@example.com', name: 'A', twoFactorEnabled: true }, { signedIn: true });
  const trees = new FakeTreesApi();
  const id = trees.addTree({
    persons: [{ ...ada }],
    ...(role === 'viewer' ? { role, detail: { capabilities: viewerCaps } } : {}),
  });
  trees.trees.get(id)!.people.set(
    ada.id,
    fakePersonView(ada, {
      capabilities: { edit: role === 'owner', addRelative: false, delete: false },
    }),
  );
  return { auth, trees, id, photos };
}
const at = (s: { id: string }) => `/trees/${s.id}/people/${ada.id}?tab=photos`;
const file = (type = 'image/png', size = 1000) =>
  Object.defineProperty(new File(['x'], 'a.png', { type }), 'size', { value: size });

async function seedPhotos(s: ReturnType<typeof setup>, n: number) {
  for (let i = 0; i < n; i++) await s.trees.uploadPhoto(s.id, ada.id, file());
  s.trees.calls.length = 0;
}

function loadCropper(w: number, h: number) {
  const img = screen.getByAltText('The chosen photo');
  Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
  fireEvent.load(img);
}
const choose = (f: File) =>
  fireEvent.change(screen.getByLabelText(/Add a photo/), { target: { files: [f] } });

afterEach(() => vi.clearAllMocks());

describe('PhotosTab', () => {
  it('starts empty with the usage line and a file input', async () => {
    const s = setup();
    renderAt(at(s), s);
    expect(await screen.findByText('No photos yet.')).toBeInTheDocument();
    expect(screen.getByText(/Photos use 0 B of this tree’s 1 GB\./)).toBeInTheDocument();
    expect(screen.getByLabelText(/Add a photo/)).toHaveAttribute(
      'accept',
      'image/jpeg,image/png,image/webp',
    );
  });

  it('uploads the whole photo and shows it with the badge, also in the panel header', async () => {
    const s = setup();
    renderAt(at(s), s);
    await screen.findByText('No photos yet.');
    const f = file();
    choose(f);
    loadCropper(400, 200);
    fireEvent.click(screen.getByRole('button', { name: 'Use the whole photo' }));
    expect(await screen.findByText('Photo added')).toBeInTheDocument();
    expect(s.trees.callsTo('uploadPhoto')[0]).toMatchObject({
      personId: ada.id,
      type: 'image/png',
    });
    const link = screen.getByRole('link', { name: /Photo 1 of Ada King/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('Main photo')).toBeInTheDocument();
    expect(document.querySelector('img.panel-photo')).toBeInTheDocument();
    expect(cropToBlob).toHaveBeenCalledWith(f, null);
  });

  it('crops: sends the cropped blob, moves with arrow keys and zooms', async () => {
    const s = setup();
    renderAt(at(s), s);
    await screen.findByText('No photos yet.');
    const f = file();
    choose(f);
    loadCropper(400, 200);
    const area = screen.getByRole('group', { name: /Crop area/ });
    const left = parseFloat(area.style.left);
    fireEvent.keyDown(area, { key: 'ArrowLeft' });
    expect(parseFloat(area.style.left)).toBeLessThan(left);
    const width = parseFloat(area.style.width);
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '2' } });
    expect(parseFloat(area.style.width)).toBeLessThan(width);
    fireEvent.click(screen.getByRole('button', { name: 'Upload this part' }));
    await screen.findByText('Photo added');
    const [, box] = vi.mocked(cropToBlob).mock.calls[0]!;
    expect(box).toMatchObject({ size: expect.any(Number) });
    expect(s.trees.callsTo('uploadPhoto')[0]).toMatchObject({ type: 'image/jpeg' });
  });

  it('keeps the cropper image URL alive under StrictMode and revokes it on unmount', () => {
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => `blob:${Math.random()}`);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const { unmount } = render(
      <StrictMode>
        <PhotoCropper file={file()} busy={false} onDone={() => {}} onCancel={() => {}} />
      </StrictMode>,
    );
    const src = screen.getByAltText('The chosen photo').getAttribute('src')!;
    expect(create.mock.results.map((r) => r.value)).toContain(src);
    expect(revoke).not.toHaveBeenCalledWith(src);
    unmount();
    expect(revoke).toHaveBeenCalledWith(src);
    create.mockRestore();
    revoke.mockRestore();
  });

  it('rejects a wrong type and a too-large file without calling the API', async () => {
    const s = setup();
    renderAt(at(s), s);
    await screen.findByText('No photos yet.');
    choose(file('image/gif'));
    expect(await screen.findByText(MESSAGES.photoType)).toBeInTheDocument();
    choose(file('image/jpeg', 10 * 1024 * 1024 + 1));
    expect(await screen.findByText(MESSAGES.photoTooLarge)).toBeInTheDocument();
    expect(s.trees.callsTo('uploadPhoto')).toEqual([]);
  });

  it('shows server errors and keeps the cropper open', async () => {
    const s = setup();
    renderAt(at(s), s);
    await screen.findByText('No photos yet.');
    s.trees.failNext('uploadPhoto', { code: 'VALIDATION', message: MESSAGES.photoDimensions });
    choose(file());
    loadCropper(400, 200);
    fireEvent.click(screen.getByRole('button', { name: 'Use the whole photo' }));
    expect(await screen.findByText(MESSAGES.photoDimensions)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    s.trees.failNext('uploadPhoto', { code: 'QUOTA_EXCEEDED', message: MESSAGES.photoQuota });
    fireEvent.click(screen.getByRole('button', { name: 'Use the whole photo' }));
    expect(await screen.findByText(MESSAGES.photoQuota)).toBeInTheDocument();
  });

  it('makes a photo main and deletes with a two-step confirm', async () => {
    const s = setup();
    await seedPhotos(s, 2);
    renderAt(at(s), s);
    fireEvent.click(await screen.findByRole('button', { name: 'Make main photo' }));
    await waitFor(() => expect(s.trees.callsTo('setPrimaryPhoto')).toHaveLength(1));
    await screen.findByText('Main photo changed');
    expect(screen.getAllByText('Main photo')).toHaveLength(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Delete photo' }));
    await screen.findByText('Photo removed');
    expect(s.trees.callsTo('deletePhoto')).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: /Photo \d of Ada King/ })).toHaveLength(1);
  });

  it('cancelling the delete confirm with Esc leaves the Photos dialog open', async () => {
    const s = setup();
    await seedPhotos(s, 1);
    renderAt(at(s), s);
    const section = await screen.findByRole('dialog', { name: 'Photos — Ada King' });
    fireEvent.click(await within(section).findByRole('button', { name: 'Delete' }));
    const confirm = within(section).getByRole('button', { name: 'Delete photo' });
    const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    confirm.dispatchEvent(key);
    // Handled (prevented), so a browser doesn't also turn it into the dialog's close request.
    expect(key.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(within(section).queryByRole('button', { name: 'Delete photo' })).toBeNull(),
    );
    expect(screen.getByRole('dialog', { name: 'Photos — Ada King' })).toBeInTheDocument();
    expect(s.trees.callsTo('deletePhoto')).toHaveLength(0);
  });

  it('Esc from a form field does not close the dialog', async () => {
    const s = setup();
    renderAt(`/trees/${s.id}/people/${ada.id}?tab=info`, s);
    const section = await screen.findByRole('dialog', { name: 'Details — Ada King' });
    fireEvent.click(within(section).getByRole('button', { name: 'Edit details' }));
    within(section).getByLabelText('Last name').focus();
    fireEvent(section, new Event('cancel', { cancelable: true }));
    expect(screen.getByRole('dialog', { name: 'Details — Ada King' })).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('lets a viewer look but not change', async () => {
    const s = setup('viewer');
    s.trees.trees.get(s.id)!.people.get(ada.id)!.photos.push({
      id: 'ph-1',
      width: 1,
      height: 1,
      bytes: 1,
      isPrimary: true,
      createdAt: new Date().toISOString(),
      uploadedByName: null,
      thumbUrl: 'https://photos.test/1/thumb',
      fullUrl: 'https://photos.test/1/full',
    });
    renderAt(at(s), s);
    expect(await screen.findByText('Main photo')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Add a photo/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make main photo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('keeps one live status region mounted and only changes its text', async () => {
    const s = setup();
    renderAt(at(s), s);
    await screen.findByText('No photos yet.');
    const region = document.querySelector('.section-dialog p[role="status"]')!;
    expect(region).toBeInTheDocument();
    expect(region).toHaveTextContent('');
    s.trees.hold('uploadPhoto');
    choose(file());
    loadCropper(400, 200);
    fireEvent.click(screen.getByRole('button', { name: 'Use the whole photo' }));
    await waitFor(() => expect(region).toHaveTextContent('Working…'));
    expect(document.querySelector('.section-dialog p[role="status"]')).toBe(region);
    s.trees.release();
    await waitFor(() => expect(region).toHaveTextContent(''));
  });
});
