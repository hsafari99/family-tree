import { resetWithCodeSchema } from '@family-tree/shared';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { ErrorSummary, Field, type FieldErrors, FormError, validate } from '../components/forms';
import {
  confirmError,
  weakPasswordError,
  NEW_PASSWORD_LABELS,
  NewPasswordFields,
} from '../components/NewPasswordFields';
import { Page } from '../components/Page';
import { PasswordChanged } from './PasswordChanged';

const RESET_LABELS: Record<string, string> = {
  email: 'Email',
  code: 'Authenticator or recovery code',
  ...NEW_PASSWORD_LABELS,
};

export function ForgotPasswordPage() {
  const { api } = useAuth();
  const [values, setValues] = useState({ email: '', code: '', newPassword: '' });
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const set = (key: keyof typeof values) => (value: string) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    const checked = validate(resetWithCodeSchema, values);
    const repeatPassword = confirmError(values.newPassword, repeat);
    setErrors({ ...(checked.ok ? {} : checked.errors), repeatPassword });
    if (!checked.ok || repeatPassword) return;
    setPending(true);
    const res = await api.resetWithCode(checked.data);
    setPending(false);
    if (!res.ok) {
      const weak = weakPasswordError(res.error);
      if (weak) setErrors({ newPassword: weak });
      else setServerError(res.error.message);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <Page title="Reset your password">
        <PasswordChanged />
      </Page>
    );
  }

  return (
    <Page title="Reset your password">
      <p>
        Use a code from your authenticator app, or one of your recovery codes, to set a new
        password.
      </p>
      <p className="hint">No authenticator? Ask your tree owner for a reset link.</p>
      <form onSubmit={onSubmit} noValidate>
        <ErrorSummary errors={errors} labels={RESET_LABELS} />
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={set('email')}
          error={errors.email}
        />
        <Field
          label="Authenticator or recovery code"
          name="code"
          autoComplete="one-time-code"
          autoCapitalize="none"
          spellCheck={false}
          value={values.code}
          onChange={set('code')}
          error={errors.code}
        />
        <NewPasswordFields
          password={values.newPassword}
          repeat={repeat}
          onPassword={set('newPassword')}
          onRepeat={setRepeat}
          errors={errors}
        />
        <FormError>{serverError}</FormError>
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Set new password'}
        </button>
      </form>
      <p>
        <Link to="/sign-in">Back to sign in</Link>
      </p>
    </Page>
  );
}
