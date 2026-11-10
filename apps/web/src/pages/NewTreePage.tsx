import { createTreeSchema, SEXES } from '@family-tree/shared';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { Field, type FieldErrors, FormError, validateDeep } from '../components/forms';
import { Page } from '../components/Page';
import { parseYear } from '../trees/format';
import { useTreesApi } from '../trees/TreesApiContext';
import { TwoFactorSetup } from './TwoFactorSetup';

const SEX_LABEL = {
  female: 'Female',
  male: 'Male',
  other: 'Other',
  unknown: 'Prefer not to say',
} as const;

export function NewTreePage() {
  const { user, refresh } = useAuth();
  // Turning 2FA on flips `twoFactorEnabled` before the recovery codes are dismissed; keep the
  // setup on screen until then, or the codes (shown only once) would vanish.
  const [codesPending, setCodesPending] = useState(false);
  // RequireAuth only renders this page for a signed-in user.
  if (user === null || user === 'loading') return null;

  return (
    <Page title="Start a new tree">
      {user.twoFactorEnabled && !codesPending ? (
        <NewTreeForm />
      ) : (
        <>
          <p>
            Tree owners must use two-step verification, because they control who can see the
            family&apos;s details. Turn it on to continue.
          </p>
          <TwoFactorSetup
            enabled={false}
            onChanged={async () => {
              setCodesPending(true);
              await refresh();
            }}
            onFinished={() => setCodesPending(false)}
          />
        </>
      )}
      <p>
        <Link to="/">Back to home</Link>
      </p>
    </Page>
  );
}

function NewTreeForm() {
  const api = useTreesApi();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({
    name: '',
    givenName: '',
    surname: '',
    sex: 'unknown',
    birthYear: '',
  });
  const [nameTouched, setNameTouched] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function setSurname(surname: string) {
    setValues((v) => ({
      ...v,
      surname,
      name: nameTouched ? v.name : surname.trim() ? `${surname.trim()} family` : '',
    }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);
    const yearNumber = parseYear(values.birthYear);
    // Our own text for input that isn't a number at all (the schema's default is English jargon).
    const yearBad = yearNumber !== undefined && Number.isNaN(yearNumber);
    const checked = validateDeep(createTreeSchema, {
      name: values.name,
      person: {
        givenName: values.givenName,
        surname: values.surname,
        sex: values.sex,
        ...(yearNumber === undefined || yearBad ? {} : { birthYear: yearNumber }),
      },
    });
    if (!checked.ok || yearBad) {
      setErrors({
        ...(checked.ok ? {} : checked.errors),
        ...(yearBad ? { 'person.birthYear': 'Enter a year, like 1990' } : {}),
      });
      return;
    }
    setErrors({});
    setPending(true);
    const res = await api.createTree(checked.data);
    setPending(false);
    if (res.ok) {
      void navigate(`/trees/${res.data.id}`);
      return;
    }
    if (res.error.code === 'TWO_FACTOR_REQUIRED') void refresh();
    setServerError(res.error.message);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <h2>About you</h2>
      <Field
        label="Tree name"
        name="name"
        value={values.name}
        onChange={(name) => {
          setNameTouched(true);
          setValues((v) => ({ ...v, name }));
        }}
        error={errors['name']}
      />
      <Field
        label="Your first name"
        name="givenName"
        autoComplete="given-name"
        value={values.givenName}
        onChange={(givenName) => setValues((v) => ({ ...v, givenName }))}
        error={errors['person.givenName']}
      />
      <Field
        label="Your last name"
        name="surname"
        autoComplete="family-name"
        value={values.surname}
        onChange={setSurname}
        error={errors['person.surname']}
      />
      <div className="field">
        <label htmlFor="new-tree-sex">Sex</label>
        <select
          id="new-tree-sex"
          value={values.sex}
          onChange={(e) => setValues((v) => ({ ...v, sex: e.target.value }))}
        >
          {SEXES.map((s) => (
            <option key={s} value={s}>
              {SEX_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <Field
        label="Birth year"
        name="birthYear"
        type="number"
        inputMode="numeric"
        value={values.birthYear}
        onChange={(birthYear) => setValues((v) => ({ ...v, birthYear }))}
        error={errors['person.birthYear']}
      />
      <FormError>{serverError}</FormError>
      <button type="submit" disabled={pending}>
        Start tree
      </button>
    </form>
  );
}
