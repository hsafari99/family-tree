import { normalizeName, type PersonSummary } from '@family-tree/shared';
import { useState } from 'react';
import { personName, personYears } from '../trees/format';

const MATCHES_MAX = 20;

/** Type 2+ letters, pick from up to 20 matches; shows the choice with a Clear button. */
export function PersonPicker({
  label,
  persons,
  value,
  onChange,
  clearLabel = 'Clear',
}: {
  label: string;
  persons: PersonSummary[];
  value: string | null;
  onChange: (id: string | null) => void;
  clearLabel?: string;
}) {
  const [text, setText] = useState('');
  const chosen = value ? persons.find((p) => p.id === value) : undefined;
  if (value) {
    return (
      <p className="person-picker branch-current">
        {label}: <strong>{chosen ? personName(chosen) : 'someone'}</strong>{' '}
        <button type="button" className="secondary" onClick={() => onChange(null)}>
          {clearLabel}
        </button>
      </p>
    );
  }
  const needle = normalizeName(text);
  const matches =
    needle.length < 2
      ? []
      : persons.filter((p) => normalizeName(personName(p)).includes(needle)).slice(0, MATCHES_MAX);
  return (
    <div className="person-picker branch-picker">
      <label>
        {label}{' '}
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              // Clear the text without also closing a surrounding search box or panel.
              e.stopPropagation();
              setText('');
            }
          }}
        />
      </label>
      {matches.length > 0 && (
        <ul className="picker-matches branch-matches">
          {matches.map((p) => {
            const years = personYears(p);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setText('');
                    onChange(p.id);
                  }}
                >
                  {personName(p)}
                  {years && ` ${years}`}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
