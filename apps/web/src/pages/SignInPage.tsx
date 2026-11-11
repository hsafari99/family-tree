import { signInSchema } from '@family-tree/shared';
import { type FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { googleErrorMessage } from '../auth/api';
import { useAuth } from '../auth/AuthContext';
import { safeNext } from '../auth/RequireAuth';
import { Field, type FieldErrors, FormError, validate } from '../components/forms';
import { GoogleSignIn } from '../components/GoogleSignIn';
import { Page } from '../components/Page';

export function SignInPage() {
  const { api, user, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  // Set when a Google round trip came back refused (?error=<code>); always a fixed message.
  const googleError = googleErrorMessage(params.get('error'));
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (key: keyof typeof values) => (value: string) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    const checked = validate(signInSchema, values);
    setErrors(checked.ok ? {} : checked.errors);
    if (!checked.ok) return;
    setPending(true);
    const res = await api.signIn(checked.data);
    if (!res.ok) {
      setPending(false);
      setServerError(res.error.message);
      return;
    }
    if (res.data.twoFactorRequired) {
      navigate(`/sign-in/verify?next=${encodeURIComponent(next)}`);
      return;
    }
    await refresh();
    navigate(next, { replace: true });
  }

  // Already signed in: there is nothing to do here.
  if (user && user !== 'loading') return <Navigate to={next} replace />;

  return (
    <Page title="Sign in">
      <FormError>{googleError}</FormError>
      <form onSubmit={onSubmit} noValidate>
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
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={values.password}
          onChange={set('password')}
          error={errors.password}
        />
        <FormError>{serverError}</FormError>
        <button type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <GoogleSignIn next={next} />
      <p>
        <Link to="/forgot-password">Forgot password?</Link>
      </p>
      <p>
        New here?{' '}
        <Link to={`/sign-up${next === '/' ? '' : `?next=${encodeURIComponent(next)}`}`}>
          Create an account
        </Link>
      </p>
    </Page>
  );
}
