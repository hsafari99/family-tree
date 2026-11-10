import type { DeleteMode, DeletePreview } from '@family-tree/shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { MESSAGES } from '../../auth/api';
import { ConfirmButton } from '../../components/ConfirmButton';
import { FormError } from '../../components/forms';
import { personName, personYears } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';

export const DELETE_NOTICE = 'Moved to Trash. The owner can restore it from the Trash.';
const SHOWN = 20;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function DeletePerson({
  treeId,
  personId,
  onChanged,
}: {
  treeId: string;
  personId: string;
  onChanged: () => void;
}) {
  const api = useTreesApi();
  const navigate = useNavigate();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DeleteMode>('person');
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setPreview(null);
    setError(null);
    void api.previewDelete(treeId, personId, mode).then((res) => {
      if (!active) return;
      if (res.ok) setPreview(res.data);
      else setError(res.error.message);
    });
    return () => {
      active = false;
    };
  }, [api, treeId, personId, mode, open]);

  async function remove() {
    setError(null);
    setPending(true);
    const res = await api.deletePerson(treeId, personId, mode);
    if (!alive.current) return;
    setPending(false);
    if (!res.ok) return setError(res.error.message);
    onChanged();
    void navigate(`/trees/${treeId}`, { state: { notice: DELETE_NOTICE } });
  }

  return (
    <section>
      <h3>Delete this person</h3>
      {!open ? (
        <button type="button" className="secondary" onClick={() => setOpen(true)}>
          Delete…
        </button>
      ) : (
        <div>
          <fieldset>
            <legend>What to delete</legend>
            <label>
              <input
                type="radio"
                name="delete-mode"
                checked={mode === 'person'}
                onChange={() => setMode('person')}
                style={{ width: 'auto' }}
              />{' '}
              Just this person
            </label>
            <label>
              <input
                type="radio"
                name="delete-mode"
                checked={mode === 'descendants'}
                onChange={() => setMode('descendants')}
                style={{ width: 'auto' }}
              />{' '}
              This person and their descendants
            </label>
          </fieldset>
          <FormError>{error}</FormError>
          {!preview && !error && <p>Loading preview…</p>}
          {preview && (
            <PreviewBody
              preview={preview}
              pending={pending}
              onConfirm={() => void remove()}
              mode={mode}
            />
          )}
          <p>
            <button type="button" className="secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </p>
        </div>
      )}
    </section>
  );
}

function PreviewBody({
  preview,
  pending,
  onConfirm,
  mode,
}: {
  preview: DeletePreview;
  pending: boolean;
  onConfirm: () => void;
  mode: DeleteMode;
}) {
  const parts = [
    preview.unions > 0
      ? `${plural(preview.unions, 'relationship ends', 'relationships end')}`
      : null,
    preview.links > 0
      ? `${plural(preview.links, 'parent–child link is', 'parent–child links are')} removed`
      : null,
  ].filter(Boolean);
  return (
    <div>
      <p>This moves {plural(preview.people.length, 'person', 'people')} to the Trash:</p>
      <ul>
        {preview.people.slice(0, SHOWN).map((p) => (
          <li key={p.id}>
            {personName(p)} {personYears(p)}
          </li>
        ))}
      </ul>
      {preview.people.length > SHOWN && <p>and {preview.people.length - SHOWN} more</p>}
      {parts.length > 0 && <p>{parts.join(' and ')}.</p>}
      {mode === 'person' && (
        <p className="hint">
          Relatives stay in the tree. Anyone no longer connected to the starting person will show as
          disconnected.
        </p>
      )}
      {preview.blockedByRoot ? (
        <p className="error">
          This includes the tree’s starting person. Choose a new starting person in Tree settings
          first.
        </p>
      ) : preview.outsideScope > 0 ? (
        <p className="error">
          This includes {plural(preview.outsideScope, 'person', 'people')} outside your branch. Ask
          the owner to delete it.
        </p>
      ) : !preview.allowed ? (
        <p className="error">{MESSAGES.forbidden}</p>
      ) : (
        <ConfirmButton
          label="Move to Trash"
          confirmLabel="Yes, move to Trash"
          danger
          pending={pending}
          onConfirm={onConfirm}
        />
      )}
    </div>
  );
}
