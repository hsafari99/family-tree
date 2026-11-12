import { normalizeName, type PersonSummary } from '@family-tree/shared';
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { personName, personYears } from '../trees/format';
import { SearchIcon } from './icons';

const MATCHES_MAX = 20;
const GAP = 4;

/**
 * Where the matches list goes, in viewport coordinates: under the input, or above it when there is
 * more room there. `position: fixed`, so it overlays the content (nothing below moves) and no
 * scrolling ancestor (the side panel, a dialog's body, the search filters) can clip it.
 */
export function placeMatches(
  input: DOMRect,
  viewportWidth: number,
  viewportHeight: number,
): CSSProperties {
  const below = viewportHeight - input.bottom - GAP * 2;
  const above = input.top - GAP * 2;
  // At least 240px wide, kept inside the window.
  const width = Math.min(Math.max(input.width, 240), viewportWidth - GAP * 4);
  const left = Math.max(GAP * 2, Math.min(input.left, viewportWidth - width - GAP * 2));
  const base = { position: 'fixed', left, width } as const;
  return below >= 160 || below >= above
    ? { ...base, top: input.bottom + GAP, maxHeight: Math.min(320, below) }
    : { ...base, bottom: viewportHeight - input.top + GAP, maxHeight: Math.min(320, above) };
}

/** Type 2+ letters, pick from up to 20 matches; shows the choice with a Clear button. */
export function PersonPicker({
  label,
  persons,
  value,
  onChange,
  clearLabel = 'Clear',
  clearAriaLabel,
  hideLabel = false,
  placeholder,
}: {
  label: string;
  persons: PersonSummary[];
  value: string | null;
  onChange: (id: string | null) => void;
  clearLabel?: string;
  /** When two pickers share a clear label, a name that tells them apart. */
  clearAriaLabel?: string;
  /** Shows the label as the placeholder instead of above the field (it stays the name). */
  hideLabel?: boolean;
  /** The placeholder when the label is hidden (the label itself by default). */
  placeholder?: string;
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
  const needle = normalizeName(text);
  const matches =
    value || needle.length < 2
      ? []
      : persons.filter((p) => normalizeName(personName(p)).includes(needle)).slice(0, MATCHES_MAX);
  const open = matches.length > 0;
  const [place, setPlace] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open) return setPlace(null);
    const move = () => {
      const el = input.current;
      if (el)
        setPlace(placeMatches(el.getBoundingClientRect(), window.innerWidth, window.innerHeight));
    };
    move();
    // Fixed, so it follows the input when anything scrolls or the window resizes.
    window.addEventListener('scroll', move, true);
    window.addEventListener('resize', move);
    return () => {
      window.removeEventListener('scroll', move, true);
      window.removeEventListener('resize', move);
    };
  }, [open]);
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
  return (
    <div className="person-picker branch-picker">
      <label>
        {/* With `hideLabel` the label is the placeholder on screen, and still the input's name. */}
        {hideLabel ? <span className="sr-only">{label}</span> : <>{label} </>}
        <span className="search-field">
          <SearchIcon />
          <input
            ref={input}
            type="search"
            placeholder={hideLabel ? (placeholder ?? label) : undefined}
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
        </span>
      </label>
      {matches.length > 0 && (
        <ul className="picker-matches branch-matches" style={place ?? { visibility: 'hidden' }}>
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
