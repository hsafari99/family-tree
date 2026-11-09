import { type InputHTMLAttributes, type ReactNode, useId } from 'react';

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

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'onChange'> & {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
};

/** A labelled input with its hint and validation message tied to it for screen readers. */
export function Field({ label, error, hint, onChange, ...input }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p id={hintId} className="hint">
          {hint}
        </p>
      )}
      <input
        id={id}
        {...input}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
      />
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
