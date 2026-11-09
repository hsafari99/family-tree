import { PASSWORD_MIN, resetWithLinkSchema } from '@family-tree/shared';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { Field, FormError, validate } from '../components/forms';
import { Page } from '../components/Page';
import { PasswordChanged } from './PasswordChanged';

export const INVALID_LINK = 'This reset link is invalid or has already been used';

export function ResetLinkPage() {
  const { api } = useAuth();
  const { token = '' } = useParams();
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    const checked = validate(resetWithLinkSchema, { token, newPassword });
    if (!checked.ok) {
      setError(checked.errors.newPassword);
      if (checked.errors.token) setServerError(INVALID_LINK);
      return;
    }
    setError(undefined);
    setPending(true);
    const res = await api.resetWithLink(checked.data);
    setPending(false);
    if (!res.ok) {
      setServerError(res.error.code === 'INVALID_RESET' ? INVALID_LINK : res.error.message);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <Page title="Choose a new password">
        <PasswordChanged />
      </Page>
    );
  }

  return (
    <Page title="Choose a new password">
      <form onSubmit={onSubmit} noValidate>
        <Field
          label="New password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN} characters.`}
          value={newPassword}
          onChange={setNewPassword}
          error={error}
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
