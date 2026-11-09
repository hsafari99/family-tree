import { totpCodeSchema } from '@family-tree/shared';
import QRCode from 'qrcode';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Field, FormError, validate } from '../components/forms';

type Step =
  | { kind: 'idle' }
  | { kind: 'password'; purpose: 'enable' | 'regenerate' | 'disable' }
  | { kind: 'scan'; totpURI: string; backupCodes: string[] }
  | { kind: 'codes'; codes: string[] };

const PROMPTS = {
  enable: { title: 'Turn on two-step verification', submit: 'Continue' },
  regenerate: { title: 'Generate new recovery codes', submit: 'Generate codes' },
  disable: { title: 'Turn off two-step verification', submit: 'Turn off' },
} as const;

/** The Two-step verification section of the account page. */
export function TwoFactorSetup({
  enabled,
  onChanged,
}: {
  enabled: boolean;
  onChanged: () => Promise<void>;
}) {
  const { api } = useAuth();
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);

  async function onPassword(
    purpose: 'enable' | 'regenerate' | 'disable',
    password: string,
  ): Promise<string | null> {
    if (purpose === 'enable') {
      const res = await api.startTwoFactorSetup({ password });
      if (!res.ok) return res.error.message;
      setStep({ kind: 'scan', ...res.data });
    } else if (purpose === 'regenerate') {
      const res = await api.regenerateRecoveryCodes({ password });
      if (!res.ok) return res.error.message;
      setStep({ kind: 'codes', codes: res.data });
    } else {
      const res = await api.disableTwoFactor({ password });
      if (!res.ok) return res.error.message;
      setStep({ kind: 'idle' });
      setNotice('Two-step verification is off.');
      await onChanged();
    }
    return null;
  }

  return (
    <section aria-labelledby="two-factor-heading">
      <h2 id="two-factor-heading">Two-step verification</h2>
      {step.kind === 'idle' && (
        <>
          <p>
            {enabled
              ? 'Signing in needs a code from your authenticator app as well as your password.'
              : 'Protect your account with a code from an authenticator app as well as your password.'}
          </p>
          {notice && (
            <p role="status" className="success">
              {notice}
            </p>
          )}
          <div className="actions">
            {enabled ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setNotice(null);
                    setStep({ kind: 'password', purpose: 'regenerate' });
                  }}
                >
                  Generate new recovery codes
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    setNotice(null);
                    setStep({ kind: 'password', purpose: 'disable' });
                  }}
                >
                  Turn off two-step verification
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setNotice(null);
                  setStep({ kind: 'password', purpose: 'enable' });
                }}
              >
                Turn on two-step verification
              </button>
            )}
          </div>
        </>
      )}
      {step.kind === 'password' && (
        <PasswordPrompt
          key={step.purpose}
          title={PROMPTS[step.purpose].title}
          submitLabel={PROMPTS[step.purpose].submit}
          onSubmit={(password) => onPassword(step.purpose, password)}
          onCancel={() => setStep({ kind: 'idle' })}
        />
      )}
      {step.kind === 'scan' && (
        <ScanAndConfirm
          totpURI={step.totpURI}
          onConfirmed={async () => {
            setStep({ kind: 'codes', codes: step.backupCodes });
            await onChanged();
          }}
          onCancel={() => setStep({ kind: 'idle' })}
        />
      )}
      {step.kind === 'codes' && (
        <RecoveryCodes
          codes={step.codes}
          onDone={() => {
            setStep({ kind: 'idle' });
            setNotice('Two-step verification is on.');
          }}
        />
      )}
    </section>
  );
}

function PasswordPrompt({
  title,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  submitLabel: string;
  /** Resolves to an error message, or null on success. */
  onSubmit: (password: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mounted = useMounted();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (password === '') {
      setError('Enter your password');
      return;
    }
    setError(undefined);
    setPending(true);
    const message = await onSubmit(password);
    if (!mounted.current) return;
    setPending(false);
    setServerError(message);
  }

  return (
    <form onSubmit={submit} noValidate aria-label={title}>
      <h3>{title}</h3>
      <Field
        label="Your password"
        name="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        error={error}
      />
      <FormError>{serverError}</FormError>
      <div className="actions">
        <button type="submit" disabled={pending}>
          {submitLabel}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function secretFrom(totpURI: string): string {
  try {
    return new URL(totpURI).searchParams.get('secret') ?? '';
  } catch {
    return '';
  }
}

function ScanAndConfirm({
  totpURI,
  onConfirmed,
  onCancel,
}: {
  totpURI: string;
  onConfirmed: () => Promise<void>;
  onCancel: () => void;
}) {
  const { api } = useAuth();
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mounted = useMounted();

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(totpURI, { margin: 1, width: 200 }).then(
      (url) => active && setQr(url),
      () => active && setQr(null),
    );
    return () => {
      active = false;
    };
  }, [totpURI]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    const checked = validate(totpCodeSchema, code);
    setError(checked.ok ? undefined : checked.errors['']);
    if (!checked.ok) return;
    setPending(true);
    const res = await api.confirmTwoFactorSetup({ code: checked.data });
    if (!mounted.current) return;
    setPending(false);
    if (!res.ok) {
      setServerError(res.error.message);
      return;
    }
    await onConfirmed();
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Set up your authenticator app">
      <h3>Scan with your authenticator app</h3>
      {qr && <img className="qr" src={qr} alt="QR code for your authenticator app" />}
      <p>Can’t scan it? Enter this key in the app instead:</p>
      <p>
        <code className="secret">{secretFrom(totpURI)}</code>
      </p>
      <Field
        label="6-digit code from the app"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={code}
        onChange={setCode}
        error={error}
      />
      <FormError>{serverError}</FormError>
      <div className="actions">
        <button type="submit" disabled={pending}>
          {pending ? 'Checking…' : 'Turn on'}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const text = `Family Tree recovery codes\nEach code works once.\n\n${codes.join('\n')}\n`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied('Copied to the clipboard.');
    } catch {
      setCopied('Couldn’t copy. Select the codes and copy them yourself.');
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'family-tree-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h3>Save your recovery codes</h3>
      <p>
        If you lose your phone, each of these {codes.length} codes lets you sign in or reset your
        password once. Keep them somewhere safe: they won’t be shown again.
      </p>
      <ul className="codes" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button type="button" className="secondary" onClick={() => void copy()}>
          Copy
        </button>
        <button type="button" className="secondary" onClick={download}>
          Download as .txt
        </button>
        <button type="button" onClick={onDone}>
          I've saved these codes
        </button>
      </div>
      {copied && <p role="status">{copied}</p>}
    </div>
  );
}

function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
