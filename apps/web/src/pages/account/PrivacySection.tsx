import {
  type MyPrivacy,
  PRIVACY_STEPS_MAX,
  type PrivacyLevel,
  type TreeList,
} from '@family-tree/shared';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { FormError, Success } from '../../components/forms';
import { useTreesApi } from '../../trees/TreesApiContext';

type Settings = MyPrivacy['settings'];

const LEVELS: { value: PrivacyLevel; label: string; hint: string }[] = [
  {
    value: 'public',
    label: 'Everyone in this tree and linked trees',
    hint: 'Every member of this tree, and of trees linked to it, sees your details.',
  },
  {
    value: 'branch',
    label: 'My branch',
    hint: 'Only members close to you in the family see your details.',
  },
  { value: 'private', label: 'Only me', hint: 'Other members see only your name.' },
];

/**
 * Account > Privacy (privacy spec R8): per tree, who sees the details of the person the member is
 * linked to. Owners and editors always see everything (D7), so the page says so.
 */
export function PrivacySection() {
  const api = useTreesApi();
  const [trees, setTrees] = useState<TreeList['trees'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api.listTrees().then((res) => {
      if (!live) return;
      if (res.ok) setTrees(res.data.trees);
      else setError(res.error.message);
    });
    return () => {
      live = false;
    };
  }, [api]);

  return (
    <section aria-labelledby="privacy-heading">
      <h2 id="privacy-heading" tabIndex={-1}>
        Privacy
      </h2>
      <p>
        Choose who in each family tree can see your details. Your name and your place in the tree
        are always shown. Tree owners and editors can always see everything.
      </p>
      <FormError>{error}</FormError>
      {trees === null && !error && <p>Loading…</p>}
      {trees?.length === 0 && <p>You aren’t in any family tree yet.</p>}
      {trees?.map((t) => (
        <TreePrivacy key={t.id} treeId={t.id} treeName={t.name} />
      ))}
    </section>
  );
}

function TreePrivacy({ treeId, treeName }: { treeId: string; treeName: string }) {
  const api = useTreesApi();
  const id = useId();
  const [loaded, setLoaded] = useState<MyPrivacy | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let live = true;
    void api.getMyPrivacy(treeId).then((res) => {
      if (!live) return;
      if (res.ok) {
        setLoaded(res.data);
        setForm(res.data.settings);
      } else setError(res.error.message);
    });
    return () => {
      live = false;
    };
  }, [api, treeId]);

  const set = (patch: Partial<Settings>) => {
    setSaved(false);
    setForm((f) => (f ? { ...f, ...patch } : f));
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    setPending(true);
    const res = await api.setMyPrivacy(treeId, {
      ...form,
      steps: form.level === 'branch' ? (form.steps ?? 1) : null,
    });
    setPending(false);
    if (res.ok) setSaved(true);
    else setError(res.error.message);
  }

  const headingId = `${id}-heading`;
  return (
    <section className="card privacy-tree" aria-labelledby={headingId}>
      <h3 id={headingId}>{treeName}</h3>
      {loaded === null ? (
        <>
          <FormError>{error}</FormError>
          {!error && <p>Loading…</p>}
        </>
      ) : loaded.personId === null ? (
        <p>
          You aren’t linked to a person in this tree yet, so there is nothing to hide. Open the{' '}
          <Link to={`/trees/${treeId}`}>tree</Link> and choose “This is me” on your card.
        </p>
      ) : (
        form && (
          <form onSubmit={onSubmit} noValidate>
            <fieldset>
              <legend>Who can see your details</legend>
              {LEVELS.map((l) => (
                <div className="choice" key={l.value}>
                  <input
                    type="radio"
                    id={`${id}-${l.value}`}
                    name={`${id}-level`}
                    value={l.value}
                    checked={form.level === l.value}
                    onChange={() =>
                      set({
                        level: l.value,
                        steps: l.value === 'branch' ? (form.steps ?? 2) : null,
                      })
                    }
                    aria-describedby={`${id}-${l.value}-hint`}
                  />
                  <label htmlFor={`${id}-${l.value}`}>{l.label}</label>
                  <p className="hint" id={`${id}-${l.value}-hint`}>
                    {l.hint}
                  </p>
                </div>
              ))}
            </fieldset>
            {form.level === 'branch' && (
              <div className="field">
                <label htmlFor={`${id}-steps`}>How close</label>
                <p className="hint" id={`${id}-steps-hint`}>
                  Each parent, child, partner or sibling is one step. Your parents and siblings are
                  1 step away, your grandparents 2 and your cousins 3.
                </p>
                <select
                  id={`${id}-steps`}
                  value={form.steps ?? 2}
                  onChange={(e) => set({ steps: Number(e.target.value) })}
                  aria-describedby={`${id}-steps-hint`}
                >
                  {Array.from({ length: PRIVACY_STEPS_MAX }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      Up to {n} {n === 1 ? 'step' : 'steps'} away
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="choice">
              <input
                type="checkbox"
                id={`${id}-year`}
                checked={form.hideBirthYear}
                onChange={(e) => set({ hideBirthYear: e.target.checked })}
                aria-describedby={`${id}-year-hint`}
              />
              <label htmlFor={`${id}-year`}>Show my birthday but hide the year</label>
              <p className="hint" id={`${id}-year-hint`}>
                Others see the day and month you were born, but not your age.
              </p>
            </div>
            <FormError>{error}</FormError>
            {saved && <Success>Privacy saved</Success>}
            <button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save privacy'}
            </button>
          </form>
        )
      )}
    </section>
  );
}
