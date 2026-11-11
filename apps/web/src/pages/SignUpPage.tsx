import { PASSWORD_HINT, signUpSchema } from '@family-tree/shared';
import { type FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { safeNext } from '../auth/RequireAuth';
import { ErrorSummary, Field, type FieldErrors, FormError, validate } from '../components/forms';
import { weakPasswordError } from '../components/NewPasswordFields';
import { GoogleSignIn } from '../components/GoogleSignIn';
import { Page } from '../components/Page';

const SIGN_UP_LABELS: Record<string, string> = {
  name: 'Name',
  email: 'Email',
  password: 'Password',
};

export function SignUpPage() {
  const { api, user, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (key: keyof typeof values) => (value: string) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    const checked = validate(signUpSchema, values);
    setErrors(checked.ok ? {} : checked.errors);
    if (!checked.ok) return;
    setPending(true);
    const res = await api.signUp(checked.data);
    if (!res.ok) {
      setPending(false);
      const weak = weakPasswordError(res.error);
      if (weak) setErrors({ password: weak });
      else setServerError(res.error.message);
      return;
    }
    await refresh();
    navigate(next, { replace: true });
  }

  // Already signed in: there is nothing to do here.
  if (user && user !== 'loading') return <Navigate to={next} replace />;

  return (
    <Page title="Create an account">
      <form onSubmit={onSubmit} noValidate>
        <ErrorSummary errors={errors} labels={SIGN_UP_LABELS} />
        <Field
          label="Name"
          name="name"
          autoComplete="name"
          value={values.name}
          onChange={set('name')}
          error={errors.name}
        />
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
          autoComplete="new-password"
          hint={PASSWORD_HINT}
          value={values.password}
          onChange={set('password')}
          error={errors.password}
        />
        <FormError>{serverError}</FormError>
        <button type="submit" disabled={pending}>
          {pending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <GoogleSignIn next={next} />
      <p>
        Already have an account?{' '}
        <Link to={`/sign-in${next === '/' ? '' : `?next=${encodeURIComponent(next)}`}`}>
          Sign in
        </Link>
      </p>
    </Page>
  );
}
