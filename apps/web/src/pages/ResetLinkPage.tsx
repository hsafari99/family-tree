import { resetWithLinkSchema } from '@family-tree/shared';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { ErrorSummary, type FieldErrors, FormError, validate } from '../components/forms';
import {
  confirmError,
  weakPasswordError,
  NEW_PASSWORD_LABELS,
  NewPasswordFields,
} from '../components/NewPasswordFields';
import { Page } from '../components/Page';
import { PasswordChanged } from './PasswordChanged';

export const INVALID_LINK = 'This reset link is invalid or has already been used';

export function ResetLinkPage() {
  const { api } = useAuth();
  const { token = '' } = useParams();
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    const checked = validate(resetWithLinkSchema, { token, newPassword });
    const repeatPassword = confirmError(newPassword, repeat);
    setErrors({ newPassword: checked.ok ? undefined : checked.errors.newPassword, repeatPassword });
    if (!checked.ok) {
      if (checked.errors.token) setServerError(INVALID_LINK);
      return;
    }
    if (repeatPassword) return;
    setPending(true);
    const res = await api.resetWithLink(checked.data);
    setPending(false);
    if (!res.ok) {
      const weak = weakPasswordError(res.error);
      if (weak) setErrors({ newPassword: weak });
      else setServerError(res.error.code === 'INVALID_RESET' ? INVALID_LINK : res.error.message);
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
        <ErrorSummary errors={errors} labels={NEW_PASSWORD_LABELS} />
        <NewPasswordFields
          password={newPassword}
          repeat={repeat}
          onPassword={setNewPassword}
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
