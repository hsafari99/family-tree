import { type InputHTMLAttributes, type ReactNode, useId, useState } from 'react';

export type FieldErrors = Partial<Record<string, string>>;

/** The part of a Zod schema `validate` uses (keeps zod out of this package's dependencies). */
interface Schema<T> {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: readonly { path: PropertyKey[]; message: string }[] } };
}

/** Validates with a shared schema; on failure returns the first message for each field. */
export function validate<T>(
  schema: Schema<T>,
  values: unknown,
): { ok: true; data: T } | { ok: false; errors: FieldErrors } {
  const parsed = schema.safeParse(values);
  if (parsed.success) return { ok: true, data: parsed.data };
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? '');
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}

/** Like `validate`, but keys errors by the whole path ("person.givenName"), for nested forms. */
export function validateDeep<T>(
  schema: Schema<T>,
  values: unknown,
): { ok: true; data: T } | { ok: false; errors: FieldErrors } {
  const parsed = schema.safeParse(values);
  if (parsed.success) return { ok: true, data: parsed.data };
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    errors[issue.path.map(String).join('.')] ??= issue.message;
  }
  return { ok: false, errors };
}

/** The error for `key` or for any part under it ("person.birthDate.date1" for "person.birthDate"). */
export function errorAt(errors: FieldErrors, key: string): string | undefined {
  return errors[key] ?? Object.entries(errors).find(([k, m]) => m && k.startsWith(`${key}.`))?.[1];
}

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'onChange'> & {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
};

/** A labelled input with its hint and validation message tied to it for screen readers.
 *  A password input gets a Show/Hide toggle (#1). */
export function Field({ label, error, hint, onChange, type, ...input }: FieldProps) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  const isPassword = type === 'password';
  const control = (
    <input
      id={id}
      {...input}
      type={isPassword && shown ? 'text' : type}
      data-field={input.name}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy || undefined}
    />
  );
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p id={hintId} className="hint">
          {hint}
        </p>
      )}
      {isPassword ? (
        <div className="password-input">
          {control}
          {/* The label stays fixed; aria-pressed carries the state (WAI-ARIA toggle button). */}
          <button
            type="button"
            className="secondary compact"
            aria-label="Show password"
            aria-pressed={shown}
            aria-controls={id}
            onClick={() => setShown((s) => !s)}
          >
            <span aria-hidden="true">{shown ? 'Hide' : 'Show'}</span>
          </button>
        </div>
      ) : (
        control
      )}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** The alert region for a server error. */
export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="error">
      {children}
    </div>
  );
}

export function Success({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="success">
      {children}
    </div>
  );
}
