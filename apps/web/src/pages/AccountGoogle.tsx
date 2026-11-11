import { PASSWORD_HINT, passwordSchema, resetCodeSchema } from '@family-tree/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { googleErrorMessage, MESSAGES, type SessionUser } from '../auth/api';
import { useAuth } from '../auth/AuthContext';
import { ConfirmButton } from '../components/ConfirmButton';
import {
  ErrorSummary,
  Field,
  type FieldErrors,
  FormError,
  Success,
  validate,
} from '../components/forms';
import { CheckCircleIcon, CrossCircleIcon } from '../components/icons';

/**
 * Account settings: connect Google (password, plus a code when 2FA is on) or disconnect it
 * (only while a password remains). Hidden when Google sign-in is off and nothing is connected.
 */
export function GoogleSection({
  user,
  enabled,
  onChanged,
}: {
  user: SessionUser;
  /** Whether the server offers Google sign-in (`useGoogleEnabled`). */
  enabled: boolean;
  onChanged: () => Promise<void>;
}) {
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Set by Google's return trip; read once, so a later disconnect doesn't contradict it.
  const [returned] = useState(() => ({
    connected: params.get('google') === 'connected',
    error: googleErrorMessage(params.get('error'), 'connect'),
  }));
  useEffect(() => {
    if (params.has('google') || params.has('error')) setParams({}, { replace: true });
  }, [params, setParams]);

  if (!enabled && !user.googleConnected) {
    return (
      <section aria-labelledby="google-heading">
        <h2 id="google-heading" tabIndex={-1}>
          Google sign-in
        </h2>
        <p>Signing in with Google isn’t available.</p>
      </section>
    );
  }

  async function disconnected() {
    await onChanged();
    setNotice('Google disconnected. Sign in with your email and password from now on.');
    headingRef.current?.focus();
  }

  return (
    <section aria-labelledby="google-heading">
      <h2 id="google-heading" ref={headingRef} tabIndex={-1}>
        Google sign-in
      </h2>
      <dl className="details">
        <dt>Status</dt>
        <dd>
          {/* The words carry the status; the icon and colour only reinforce them. */}
          {user.googleConnected ? (
            <span className="connection-status connection-status--on">
              <CheckCircleIcon />
              Connected
            </span>
          ) : (
            <span className="connection-status connection-status--off">
              <CrossCircleIcon />
              Not connected
            </span>
          )}
        </dd>
      </dl>
      {notice ? (
        <Success>
          <p>{notice}</p>
        </Success>
      ) : (
        returned.connected &&
        user.googleConnected && (
          <Success>
            <p>Google is connected. You can sign in with Google from now on.</p>
          </Success>
        )
      )}
      {!notice && <FormError>{returned.error}</FormError>}
      {user.googleConnected ? (
        <DisconnectGoogle
          hasPassword={user.hasPassword}
          twoFactorEnabled={user.twoFactorEnabled}
          onDone={disconnected}
        />
      ) : (
        <ConnectGoogle twoFactorEnabled={user.twoFactorEnabled} />
      )}
    </section>
  );
}

function ConnectGoogle({ twoFactorEnabled }: { twoFactorEnabled: boolean }) {
  const { api } = useAuth();
  const [values, setValues] = useState({ password: '', code: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (key: keyof typeof values) => (value: string) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    const next: FieldErrors = {};
    if (values.password === '') next.password = MESSAGES.passwordRequired;
    const code = twoFactorEnabled ? validate(resetCodeSchema, values.code) : null;
    if (code && !code.ok) next.code = code.errors[''];
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setPending(true);
    const res = await api.connectGoogle({
      password: values.password,
      ...(code?.ok ? { code: code.data } : {}),
    });
    // On success the page is leaving for Google; stay busy until it does.
    if (!res.ok) {
      setPending(false);
      setServerError(res.error.message);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <p>
        Sign in with your Google account as well as your password. Confirm it&apos;s you first; then
        Google asks which account to connect.
      </p>
      <Field
        label="Your password, to connect Google"
        name="googlePassword"
        type="password"
        autoComplete="current-password"
        value={values.password}
        onChange={set('password')}
        error={errors.password}
      />
      {twoFactorEnabled && (
        <Field
          label="Authenticator or recovery code"
          name="googleCode"
          hint="The 6-digit code from your authenticator app, or one of your recovery codes."
          autoComplete="one-time-code"
          autoCapitalize="none"
          spellCheck={false}
          value={values.code}
          onChange={set('code')}
          error={errors.code}
        />
      )}
      <FormError>{serverError}</FormError>
      <button type="submit" disabled={pending}>
        {pending ? 'Opening Google…' : 'Connect Google'}
      </button>
    </form>
  );
}

function DisconnectGoogle({
  hasPassword,
  twoFactorEnabled,
  onDone,
}: {
  hasPassword: boolean;
  twoFactorEnabled: boolean;
  onDone: () => Promise<void>;
}) {
  const { api } = useAuth();
  const [values, setValues] = useState({ password: '', code: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (key: keyof typeof values) => (value: string) =>
    setValues((v) => ({ ...v, [key]: value }));

  if (!hasPassword) {
    return (
      <p>
        Google is your only way to sign in. Set a password above before you disconnect it, so you
        can still get in.
      </p>
    );
  }

  async function onConfirm() {
    setError(null);
    const next: FieldErrors = {};
    if (values.password === '') next.password = MESSAGES.passwordRequired;
    const code = twoFactorEnabled ? validate(resetCodeSchema, values.code) : null;
    if (code && !code.ok) next.code = code.errors[''];
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setPending(true);
    const res = await api.disconnectGoogle({
      password: values.password,
      ...(code?.ok ? { code: code.data } : {}),
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    await onDone();
  }

  return (
    <>
      <p>
        You can sign in with Google or with your email and password. To disconnect Google, confirm
        it&apos;s you.
      </p>
      <Field
        label="Your password, to disconnect Google"
        name="disconnectPassword"
        type="password"
        autoComplete="current-password"
        value={values.password}
        onChange={set('password')}
        error={errors.password}
      />
      {twoFactorEnabled && (
        <Field
          label="Authenticator or recovery code"
          name="disconnectCode"
          hint="The 6-digit code from your authenticator app, or one of your recovery codes."
          autoComplete="one-time-code"
          autoCapitalize="none"
          spellCheck={false}
          value={values.code}
          onChange={set('code')}
          error={errors.code}
        />
      )}
      <FormError>{error}</FormError>
      <ConfirmButton
        label="Disconnect Google"
        confirmLabel="Yes, disconnect"
        danger
        pending={pending}
        onConfirm={() => void onConfirm()}
      />
    </>
  );
}

/** For an account that only ever signed in with Google: add a password login. */
const SET_PASSWORD_LABELS: Record<string, string> = { setPassword: 'New password' };

export function SetPassword({ onDone }: { onDone: () => Promise<void> }) {
  const { api } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [needsGoogle, setNeedsGoogle] = useState(false);
  const [pending, setPending] = useState(false);

  async function confirmWithGoogle() {
    setPending(true);
    const res = await api.startGoogleSignIn({ next: '/account/password' });
    // On success the page is leaving for Google.
    if (!res.ok) {
      setPending(false);
      setServerError(res.error.message);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    setNeedsGoogle(false);
    const checked = validate(passwordSchema, password);
    setError(checked.ok ? undefined : checked.errors['']);
    if (!checked.ok) return;
    setPending(true);
    const res = await api.setPassword({ newPassword: checked.data });
    setPending(false);
    if (!res.ok) {
      setServerError(res.error.message);
      setNeedsGoogle(res.error.code === 'RECENT_SIGN_IN_REQUIRED');
      return;
    }
    await onDone();
  }

  return (
    <>
      <p>
        You sign in with Google. Add a password to sign in without Google, to turn on two-step
        verification, or to delete your account.
      </p>
      <form onSubmit={onSubmit} noValidate>
        <ErrorSummary errors={error ? { setPassword: error } : {}} labels={SET_PASSWORD_LABELS} />
        <Field
          label="New password"
          name="setPassword"
          type="password"
          autoComplete="new-password"
          hint={PASSWORD_HINT}
          value={password}
          onChange={setPassword}
          error={error}
        />
        <FormError>{serverError}</FormError>
        <div className="actions">
          <button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Set password'}
          </button>
          {needsGoogle && (
            <button
              type="button"
              className="secondary"
              disabled={pending}
              onClick={() => void confirmWithGoogle()}
            >
              Sign in with Google again
            </button>
          )}
        </div>
      </form>
    </>
  );
}
