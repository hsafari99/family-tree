import { createTreeSchema, SEXES } from '@family-tree/shared';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import {
  ErrorSummary,
  errorAt,
  Field,
  type FieldErrors,
  FormError,
  validateDeep,
} from '../components/forms';
import { draftError, FuzzyDateField, fromDraft, toDraft } from '../components/FuzzyDateField';
import { Page } from '../components/Page';
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
      ) : !user.hasPassword ? (
        // Turning on 2FA asks for the password, which a Google-only account doesn't have yet.
        <p>
          Tree owners must use two-step verification, and turning it on needs a password.{' '}
          <Link to="/account/password">Set a password</Link> in Account settings first, then come
          back.
        </p>
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

const NEW_TREE_LABELS: Record<string, string> = {
  name: 'Tree name',
  'person.givenName': 'Your first name',
  'person.surname': 'Your last name',
  'person.sex': 'Sex',
  'person.birthDate': 'Born',
};

function NewTreeForm() {
  const api = useTreesApi();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({
    name: '',
    givenName: '',
    surname: '',
    sex: 'unknown',
  });
  // A calendar by default: the creator usually knows their own birthday (#4).
  const [birth, setBirth] = useState(() => toDraft(null));
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
    const birthIncomplete = draftError(birth);
    const birthDate = fromDraft(birth);
    const checked = validateDeep(createTreeSchema, {
      name: values.name,
      person: {
        givenName: values.givenName,
        surname: values.surname,
        sex: values.sex,
        ...(birthDate === null || birthIncomplete ? {} : { birthDate }),
      },
    });
    if (!checked.ok || birthIncomplete) {
      setErrors({
        ...(checked.ok ? {} : checked.errors),
        ...(birthIncomplete ? { 'person.birthDate': birthIncomplete } : {}),
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
      <ErrorSummary errors={errors} labels={NEW_TREE_LABELS} />
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
        name="person.givenName"
        autoComplete="given-name"
        value={values.givenName}
        onChange={(givenName) => setValues((v) => ({ ...v, givenName }))}
        error={errors['person.givenName']}
      />
      <Field
        label="Your last name"
        name="person.surname"
        autoComplete="family-name"
        value={values.surname}
        onChange={setSurname}
        error={errors['person.surname']}
      />
      <div className="field">
        <label htmlFor="new-tree-sex">Sex</label>
        <select
          id="new-tree-sex"
          data-field="person.sex"
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
      <FuzzyDateField
        label="Born"
        name="person.birthDate"
        value={birth}
        onChange={setBirth}
        error={errorAt(errors, 'person.birthDate')}
      />
      <FormError>{serverError}</FormError>
      <button type="submit" disabled={pending}>
        Start tree
      </button>
    </form>
  );
}
