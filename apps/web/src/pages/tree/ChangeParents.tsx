import type { PersonSummary } from '@family-tree/shared';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { personName } from '../../trees/format';

/**
 * "Change parents…" (brief #13): the keyboard way to move a child's link onto other parents,
 * beside the canvas's drag. Picks one of the parent entry's `moveTo` unions.
 */
export function ChangeParents({
  name,
  options,
  pending,
  onMove,
  onCancel,
}: {
  /** The child's name. */
  name: string;
  options: { unionId: string; parents: PersonSummary[] }[];
  pending: boolean;
  onMove: (unionId: string) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const [chosen, setChosen] = useState(options[0]?.unionId ?? '');
  const group = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    group.current?.querySelector<HTMLInputElement>('input:checked, input')?.focus();
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (chosen) onMove(chosen);
  }

  return (
    <form onSubmit={submit} aria-label={`Change parents of ${name}`} className="change-parents">
      <fieldset ref={group}>
        <legend>Move {name} to other parents</legend>
        {options.map((o) => (
          <label key={o.unionId} className="radio-row">
            <input
              type="radio"
              name={`${uid}-parents`}
              value={o.unionId}
              checked={chosen === o.unionId}
              onChange={() => setChosen(o.unionId)}
            />{' '}
            {o.parents.length > 0 ? o.parents.map(personName).join(' and ') : 'Unknown parents'}
          </label>
        ))}
      </fieldset>
      <p className="actions">
        <button type="submit" className="compact" disabled={pending || !chosen}>
          Move
        </button>
        <button type="button" className="secondary compact" onClick={onCancel}>
          Cancel
        </button>
      </p>
    </form>
  );
}
