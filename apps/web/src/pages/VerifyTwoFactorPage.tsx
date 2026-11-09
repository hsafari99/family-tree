import { recoveryCodeSchema, totpCodeSchema } from '@family-tree/shared';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { safeNext } from '../auth/RequireAuth';
import { Field, FormError, validate } from '../components/forms';
import { Page } from '../components/Page';

/** Errors after which this sign-in attempt can't continue: the user must start over. */
const RESTART_CODES = new Set(['TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE', 'INVALID_TWO_FACTOR_COOKIE']);

export function VerifyTwoFactorPage() {
  const { api, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<{ message: string; restart: boolean } | null>(
    null,
  );
  const [pending, setPending] = useState(false);

  function switchMode() {
    setMode((m) => (m === 'totp' ? 'recovery' : 'totp'));
    setCode('');
    setError(undefined);
    setServerError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    const checked = validate(mode === 'totp' ? totpCodeSchema : recoveryCodeSchema, code);
    setError(checked.ok ? undefined : checked.errors['']);
    if (!checked.ok) return;
    setPending(true);
    const res =
      mode === 'totp'
        ? await api.verifyTotp({ code: checked.data, trustDevice: false })
        : await api.verifyRecoveryCode({ code: checked.data });
    if (!res.ok) {
      setPending(false);
      setServerError({ message: res.error.message, restart: RESTART_CODES.has(res.error.code) });
      return;
    }
    await refresh();
    navigate(next, { replace: true });
  }

  return (
    <Page title="Two-step verification">
      <form onSubmit={onSubmit} noValidate>
        {mode === 'totp' ? (
          <Field
            key="totp"
            label="6-digit code"
            name="code"
            hint="Open your authenticator app and enter the code it shows for Family Tree."
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={setCode}
            error={error}
          />
        ) : (
          <Field
            key="recovery"
            label="Recovery code"
            name="code"
            hint="One of the codes you saved when you turned on two-step verification. Each works once."
            autoComplete="one-time-code"
            autoCapitalize="none"
            spellCheck={false}
            value={code}
            onChange={setCode}
            error={error}
          />
        )}
        <FormError>
          {serverError && (
            <>
              {serverError.message}
              {serverError.restart && (
                <>
                  {' '}
                  <Link to={`/sign-in?next=${encodeURIComponent(next)}`}>Sign in again</Link>
                </>
              )}
            </>
          )}
        </FormError>
        <button type="submit" disabled={pending}>
          {pending ? 'Checking…' : 'Verify'}
        </button>
      </form>
      <p>
        <button type="button" className="link" onClick={switchMode}>
          {mode === 'totp' ? 'Use a recovery code instead' : 'Use your authenticator app instead'}
        </button>
      </p>
      <p>
        <Link to="/sign-in">Back to sign in</Link>
      </p>
    </Page>
  );
}
