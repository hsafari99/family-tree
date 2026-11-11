import { resetCodeSchema, totpCodeSchema } from '@family-tree/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { MESSAGES, type SessionUser } from '../auth/api';
import { useAuth } from '../auth/AuthContext';
import { Field, type FieldErrors, FormError, Success, validate } from '../components/forms';
import { RecoveryCodes, SecretQr, useFocusOnMount, useMounted } from './TwoFactorSetup';

type Step =
  | { kind: 'idle' }
  | { kind: 'confirm' }
  | { kind: 'scan'; totpURI: string }
  | { kind: 'codes'; codes: string[] };

const MOVED =
  'Two-step verification now uses your new phone. Your old phone and old recovery codes no longer work, and your other devices have been signed out.';
const NOTHING_CHANGED = 'Nothing changed. Your current phone still works.';

/**
 * Account settings (spec §5): move two-step verification to a new phone. A wizard: confirm it's
 * you, scan the new phone's code, save the new recovery codes. 2FA stays on throughout; the
 * server swaps the new phone in only once it has confirmed a code from it.
 */
export function TwoFactorMove({
  user,
  onChanged,
}: {
  user: SessionUser;
  onChanged: () => Promise<void>;
}) {
  const { api } = useAuth();
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // Back at the start (done or cancelled): focus the section heading, so keyboard and
  // screen-reader users aren't left on a button that no longer exists.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (step.kind === 'idle') headingRef.current?.focus();
  }, [step.kind]);

  function finish(message: string) {
    setNotice(message);
    setStep({ kind: 'idle' });
  }

  return (
    <section aria-labelledby="two-factor-move-heading">
      <h3 id="two-factor-move-heading" ref={headingRef} tabIndex={-1}>
        Move to a new phone
      </h3>
      {step.kind === 'idle' && (
        <>
          <p>
            Got a new phone? Move two-step verification to it. Your current phone keeps working
            until the new one is confirmed. Lost your phone? Use a recovery code instead.
          </p>
          {notice && (
            <Success>
              <p>{notice}</p>
            </Success>
          )}
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setStep({ kind: 'confirm' });
            }}
          >
            Move to a new phone
          </button>
        </>
      )}
      {step.kind === 'confirm' && (
        <ConfirmItsYou
          hasPassword={user.hasPassword}
          onStarted={(totpURI) => setStep({ kind: 'scan', totpURI })}
          onCancel={() => setStep({ kind: 'idle' })}
        />
      )}
      {step.kind === 'scan' && (
        <ScanNewPhone
          totpURI={step.totpURI}
          onMoved={async (codes) => {
            setStep({ kind: 'codes', codes });
            await onChanged();
          }}
          onRestart={() => setStep({ kind: 'confirm' })}
          onCancel={async () => {
            // Best effort: an abandoned pending secret also expires after 10 minutes.
            await api.cancelTwoFactorMove();
            finish(NOTHING_CHANGED);
          }}
        />
      )}
      {step.kind === 'codes' && (
        <RecoveryCodes
          title="Step 3 of 3: Save your new recovery codes"
          codes={step.codes}
          onDone={() => finish(MOVED)}
        />
      )}
    </section>
  );
}

function ConfirmItsYou({
  hasPassword,
  onStarted,
  onCancel,
}: {
  hasPassword: boolean;
  onStarted: (totpURI: string) => void;
  onCancel: () => void;
}) {
  const { api } = useAuth();
  const [values, setValues] = useState({ password: '', code: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [needsGoogle, setNeedsGoogle] = useState(false);
  const [pending, setPending] = useState(false);
  const mounted = useMounted();
  const heading = useFocusOnMount();
  const set = (key: keyof typeof values) => (value: string) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    setNeedsGoogle(false);
    const next: FieldErrors = {};
    if (hasPassword && values.password === '') next.password = MESSAGES.passwordRequired;
    const code = validate(resetCodeSchema, values.code);
    if (!code.ok) next.code = code.errors[''];
    setErrors(next);
    if (!code.ok || Object.keys(next).length > 0) return;
    setPending(true);
    const res = await api.startTwoFactorMove({
      ...(hasPassword ? { password: values.password } : {}),
      code: code.data,
    });
    if (!mounted.current) return;
    setPending(false);
    if (!res.ok) {
      const recent = res.error.code === 'RECENT_SIGN_IN_REQUIRED';
      setServerError(recent ? MESSAGES.moveRecentSignIn : res.error.message);
      setNeedsGoogle(recent);
      return;
    }
    onStarted(res.data.totpURI);
  }

  async function confirmWithGoogle() {
    setPending(true);
    const res = await api.startGoogleSignIn({ next: '/account/two-step' });
    // On success the page is leaving for Google.
    if (!mounted.current) return;
    setPending(false);
    if (!res.ok) setServerError(res.error.message);
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Confirm it’s you">
      <h4 ref={heading} tabIndex={-1}>
        Step 1 of 3: Confirm it’s you
      </h4>
      <p>
        {hasPassword
          ? 'Enter your password and a code from your current phone.'
          : 'You sign in with Google. Enter a code from your current phone; if you signed in more than 10 minutes ago, sign in with Google again first.'}
      </p>
      {hasPassword && (
        <Field
          label="Your password"
          name="movePassword"
          type="password"
          autoComplete="current-password"
          value={values.password}
          onChange={set('password')}
          error={errors.password}
        />
      )}
      <Field
        label="Code from your current phone, or a recovery code"
        name="moveCurrentCode"
        hint="The 6-digit code from your authenticator app. Lost your phone? Use one of your recovery codes."
        autoComplete="one-time-code"
        autoCapitalize="none"
        spellCheck={false}
        value={values.code}
        onChange={set('code')}
        error={errors.code}
      />
      <FormError>{serverError}</FormError>
      <div className="actions">
        <button type="submit" disabled={pending}>
          {pending ? 'Checking…' : 'Continue'}
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
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ScanNewPhone({
  totpURI,
  onMoved,
  onRestart,
  onCancel,
}: {
  totpURI: string;
  onMoved: (codes: string[]) => Promise<void>;
  onRestart: () => void;
  onCancel: () => Promise<void>;
}) {
  const { api } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [pending, setPending] = useState(false);
  const mounted = useMounted();
  const heading = useFocusOnMount();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    const checked = validate(totpCodeSchema, code);
    setError(checked.ok ? undefined : checked.errors['']);
    if (!checked.ok) return;
    setPending(true);
    const res = await api.confirmTwoFactorMove({ code: checked.data });
    if (!mounted.current) return;
    setPending(false);
    if (!res.ok) {
      setServerError(res.error.message);
      // The pending secret is gone (expired or replaced): only starting again helps.
      setGone(res.error.code === 'MOVE_EXPIRED' || res.error.code === 'MOVE_NOT_STARTED');
      return;
    }
    await onMoved(res.data.backupCodes);
  }

  async function cancel() {
    setPending(true);
    await onCancel();
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Scan with your new phone">
      <h4 ref={heading} tabIndex={-1}>
        Step 2 of 3: Scan with your new phone
      </h4>
      <p>
        Open the authenticator app on your <strong>new</strong> phone and scan this code. Your
        current phone keeps working until you finish. This code is good for 10 minutes.
      </p>
      <SecretQr totpURI={totpURI} />
      <Field
        label="6-digit code from the new phone"
        name="moveNewCode"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={code}
        onChange={setCode}
        error={error}
      />
      <FormError>{serverError}</FormError>
      <div className="actions">
        {gone ? (
          <button type="button" onClick={onRestart}>
            Start again
          </button>
        ) : (
          <button type="submit" disabled={pending}>
            {pending ? 'Checking…' : 'Move to this phone'}
          </button>
        )}
        <button
          type="button"
          className="secondary"
          disabled={pending}
          onClick={() => void cancel()}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
