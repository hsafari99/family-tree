import { PASSWORD_MIN, passwordSchema } from '@family-tree/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { MESSAGES } from '../auth/api';
import { useAuth } from '../auth/AuthContext';
import { ConfirmButton } from '../components/ConfirmButton';
import { Field, type FieldErrors, FormError, Success, validate } from '../components/forms';
import { Page } from '../components/Page';
import { GoogleSection, SetPassword } from './AccountGoogle';
import { TwoFactorMove } from './TwoFactorMove';
import { TwoFactorSetup } from './TwoFactorSetup';

export function AccountPage() {
  const { user, refresh } = useAuth();
  const [passwordSet, setPasswordSet] = useState(false);
  // Joining a tree can change whether 2FA is required; don't trust a stale session.
  useEffect(() => {
    void refresh();
  }, [refresh]);
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
      {passwordSet && (
        <Success>
          <p>Password set. You can now sign in with your email too.</p>
        </Success>
      )}
      {user.hasPassword ? (
        <ChangePassword />
      ) : (
        <SetPassword
          onDone={async () => {
            await refresh();
            setPasswordSet(true);
          }}
        />
      )}
      <GoogleSection user={user} onChanged={refresh} />
      {user.hasPassword && (
        <TwoFactorSetup
          enabled={user.twoFactorEnabled}
          canDisable={!user.requiresTwoFactor}
          onChanged={refresh}
        />
      )}
      {/* Also for a Google-only account that has 2FA: it confirms with a fresh sign-in. */}
      {user.twoFactorEnabled && <TwoFactorMove user={user} onChanged={refresh} />}
      {user.hasPassword && <DeleteAccount />}
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

function DeleteAccount() {
  const { api, refresh } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const deleted = useRef(false);

  useEffect(
    () => () => {
      if (deleted.current) void refresh();
    },
    [refresh],
  );

  async function onConfirm() {
    setError(null);
    if (password === '') {
      setFieldError(MESSAGES.passwordRequired);
      return;
    }
    setFieldError(undefined);
    setPending(true);
    const res = await api.deleteAccount({ password });
    setPending(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    // Leave first: once the user is null, RequireAuth would send this page to sign-in. The
    // session is re-read when this section unmounts, i.e. once the navigation has committed.
    deleted.current = true;
    void navigate('/');
  }

  return (
    <section aria-labelledby="delete-account-heading">
      <h2 id="delete-account-heading">Delete account</h2>
      <p>
        This removes your login and your access to every tree. People you added stay in their trees.
        If you own a tree, transfer it or delete it first.
      </p>
      <Field
        label="Your password to confirm"
        name="deletePassword"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        error={fieldError}
      />
      <FormError>{error}</FormError>
      <ConfirmButton
        label="Delete my account"
        confirmLabel="Delete permanently"
        danger
        pending={pending}
        onConfirm={() => void onConfirm()}
      />
    </section>
  );
}
