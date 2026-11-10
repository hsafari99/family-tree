import { PASSWORD_MIN, signUpSchema } from '@family-tree/shared';
import { type FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { safeNext } from '../auth/RequireAuth';
import { Field, type FieldErrors, FormError, validate } from '../components/forms';
import { Page } from '../components/Page';

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
      setServerError(res.error.message);
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
          hint={`At least ${PASSWORD_MIN} characters.`}
          value={values.password}
          onChange={set('password')}
          error={errors.password}
        />
        <FormError>{serverError}</FormError>
        <button type="submit" disabled={pending}>
          {pending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p>
        Already have an account?{' '}
        <Link to={`/sign-in${next === '/' ? '' : `?next=${encodeURIComponent(next)}`}`}>
          Sign in
        </Link>
      </p>
    </Page>
  );
}
