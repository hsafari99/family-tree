import { passwordSchema } from '@family-tree/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { MESSAGES, type SessionUser } from '../../auth/api';
import { useAuth } from '../../auth/AuthContext';
import { ConfirmButton } from '../../components/ConfirmButton';
import {
  ErrorSummary,
  Field,
  type FieldErrors,
  FormError,
  Success,
  validate,
} from '../../components/forms';
import {
  confirmError,
  weakPasswordError,
  NEW_PASSWORD_LABELS,
  NewPasswordFields,
} from '../../components/NewPasswordFields';
import { GoogleSection, SetPassword } from '../AccountGoogle';
import { TwoFactorMove } from '../TwoFactorMove';
import { TwoFactorSetup } from '../TwoFactorSetup';

type SectionProps = { user: SessionUser; refresh: () => Promise<void> };

export function ProfileSection({ user }: { user: SessionUser }) {
  return (
    <section aria-labelledby="profile-heading">
      <h2 id="profile-heading" tabIndex={-1}>
        Profile
      </h2>
      <dl className="details">
        <dt>Name</dt>
        <dd>{user.name}</dd>
        <dt>Email</dt>
        <dd>{user.email}</dd>
      </dl>
    </section>
  );
}

/** The password section's name, in the nav and as its heading: what the page lets you do. */
export const passwordLabel = (user: SessionUser) =>
  user.hasPassword ? 'Change password' : 'Set a password';

export function PasswordSection({ user, refresh }: SectionProps) {
  const [passwordSet, setPasswordSet] = useState(false);
  return (
    <section aria-labelledby="password-heading">
      <h2 id="password-heading" tabIndex={-1}>
        {passwordLabel(user)}
      </h2>
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
    </section>
  );
}

export function TwoStepSection({ user, refresh }: SectionProps) {
  return (
    <>
      {user.hasPassword ? (
        // Its heading is this section's h2; the wizard focuses it when a step ends.
        <TwoFactorSetup
          enabled={user.twoFactorEnabled}
          canDisable={!user.requiresTwoFactor}
          onChanged={refresh}
        />
      ) : (
        <section aria-labelledby="two-factor-heading">
          <h2 id="two-factor-heading" tabIndex={-1}>
            Two-step verification
          </h2>
          <p>
            {user.twoFactorEnabled
              ? 'Signing in needs a code from your authenticator app.'
              : 'Turning on two-step verification asks for your password.'}{' '}
            <Link to="/account/password">Set a password</Link> to manage it here.
          </p>
        </section>
      )}
      {/* Also for a Google-only account that has 2FA: it confirms with a fresh sign-in. */}
      {user.twoFactorEnabled && <TwoFactorMove user={user} onChanged={refresh} />}
    </>
  );
}

export function GoogleAccountSection({
  user,
  refresh,
  enabled,
}: SectionProps & { enabled: boolean | null }) {
  // Until the server answers, show nothing rather than a "not available" that may be wrong.
  if (enabled === null && !user.googleConnected) return null;
  return <GoogleSection user={user} enabled={enabled === true} onChanged={refresh} />;
}

export function DeleteSection({ user }: { user: SessionUser }) {
  return (
    <section aria-labelledby="delete-account-heading">
      <h2 id="delete-account-heading" tabIndex={-1}>
        Delete account
      </h2>
      <p>
        This removes your login and your access to every tree. People you added stay in their trees.
        If you own a tree, transfer it or delete it first.
      </p>
      {user.hasPassword ? (
        <DeleteAccount />
      ) : (
        <p>
          Deleting your account asks for your password. Set a password first:{' '}
          <Link to="/account/password">Set a password</Link>.
        </p>
      )}
    </section>
  );
}

const CHANGE_PASSWORD_LABELS: Record<string, string> = {
  currentPassword: 'Current password',
  ...NEW_PASSWORD_LABELS,
};

function ChangePassword() {
  const { api } = useAuth();
  const [values, setValues] = useState({ currentPassword: '', newPassword: '' });
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
    setDone(false);
    const checked = validate(passwordSchema, values.newPassword);
    const next: FieldErrors = {};
    if (values.currentPassword === '') next.currentPassword = 'Enter your current password';
    if (!checked.ok) next.newPassword = checked.errors[''];
    next.repeatPassword = confirmError(values.newPassword, repeat);
    setErrors(next);
    if (!checked.ok || next.currentPassword || next.repeatPassword) return;
    setPending(true);
    const res = await api.changePassword({
      currentPassword: values.currentPassword,
      newPassword: checked.data,
    });
    setPending(false);
    if (!res.ok) {
      const weak = weakPasswordError(res.error);
      if (weak) setErrors({ newPassword: weak });
      else setServerError(res.error.message);
      return;
    }
    setValues({ currentPassword: '', newPassword: '' });
    setRepeat('');
    setDone(true);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <ErrorSummary errors={errors} labels={CHANGE_PASSWORD_LABELS} />
      <Field
        label="Current password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        value={values.currentPassword}
        onChange={set('currentPassword')}
        error={errors.currentPassword}
      />
      <NewPasswordFields
        password={values.newPassword}
        repeat={repeat}
        onPassword={set('newPassword')}
        onRepeat={setRepeat}
        errors={errors}
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
    <>
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
    </>
  );
}
