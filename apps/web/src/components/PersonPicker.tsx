import { normalizeName, type PersonSummary } from '@family-tree/shared';
import { useEffect, useRef, useState } from 'react';
import { personName, personYears } from '../trees/format';

const MATCHES_MAX = 20;

/** Type 2+ letters, pick from up to 20 matches; shows the choice with a Clear button. */
export function PersonPicker({
  label,
  persons,
  value,
  onChange,
  clearLabel = 'Clear',
  clearAriaLabel,
}: {
  label: string;
  persons: PersonSummary[];
  value: string | null;
  onChange: (id: string | null) => void;
  clearLabel?: string;
  /** When two pickers share a clear label, a name that tells them apart. */
  clearAriaLabel?: string;
}) {
  const [text, setText] = useState('');
  // Where focus goes after the next render: the picker swaps its own controls, which would
  // otherwise drop focus on <body>.
  const focusNext = useRef<'change' | 'input' | null>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const target = focusNext.current === 'change' ? changeButton.current : input.current;
    if (focusNext.current && target) {
      target.focus();
      focusNext.current = null;
    }
  });
  const chosen = value ? persons.find((p) => p.id === value) : undefined;
  if (value) {
    return (
      <p className="person-picker branch-current">
        {label}: <strong>{chosen ? personName(chosen) : 'someone'}</strong>{' '}
        <button
          ref={changeButton}
          type="button"
          className="secondary"
          aria-label={clearAriaLabel}
          onClick={() => {
            focusNext.current = 'input';
            onChange(null);
          }}
        >
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
          ref={input}
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
                    focusNext.current = 'change';
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
