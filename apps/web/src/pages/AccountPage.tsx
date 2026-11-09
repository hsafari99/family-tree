import { PASSWORD_MIN, passwordSchema } from '@family-tree/shared';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { Field, type FieldErrors, FormError, Success, validate } from '../components/forms';
import { Page } from '../components/Page';
import { TwoFactorSetup } from './TwoFactorSetup';

export function AccountPage() {
  const { user, refresh } = useAuth();
  // RequireAuth only renders this page for a signed-in user.
  if (user === null || user === 'loading') return null;

  return (
    <Page title="Account">
      <dl className="details">
        <dt>Name</dt>
        <dd>{user.name}</dd>
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Two-step verification</dt>
        <dd>{user.twoFactorEnabled ? 'On' : 'Off'}</dd>
      </dl>
      <ChangePassword />
      <TwoFactorSetup enabled={user.twoFactorEnabled} onChanged={refresh} />
      <p>
        <Link to="/">Back to home</Link>
      </p>
    </Page>
  );
}

function ChangePassword() {
  const { api } = useAuth();
  const [values, setValues] = useState({ currentPassword: '', newPassword: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const set = (key: keyof typeof values) => (value: string) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    setDone(false);
    const checked = validate(passwordSchema, values.newPassword);
    const next: FieldErrors = {};
    if (values.currentPassword === '') next.currentPassword = 'Enter your current password';
    if (!checked.ok) next.newPassword = checked.errors[''];
    setErrors(next);
    if (!checked.ok || next.currentPassword) return;
    setPending(true);
    const res = await api.changePassword({
      currentPassword: values.currentPassword,
      newPassword: checked.data,
    });
    setPending(false);
    if (!res.ok) {
      setServerError(res.error.message);
      return;
    }
    setValues({ currentPassword: '', newPassword: '' });
    setDone(true);
  }

  return (
    <section aria-labelledby="change-password-heading">
      <h2 id="change-password-heading">Change password</h2>
      <form onSubmit={onSubmit} noValidate>
        <Field
          label="Current password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          value={values.currentPassword}
          onChange={set('currentPassword')}
          error={errors.currentPassword}
        />
        <Field
          label="New password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN} characters.`}
          value={values.newPassword}
          onChange={set('newPassword')}
          error={errors.newPassword}
        />
        <FormError>{serverError}</FormError>
        {done && (
          <Success>
            <p>Password changed. Your other devices have been signed out.</p>
          </Success>
        )}
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </section>
  );
}
