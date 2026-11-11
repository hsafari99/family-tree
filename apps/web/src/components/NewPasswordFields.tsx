import { PASSWORD_MIN } from '@family-tree/shared';
import { Field } from './forms';

export function confirmError(password: string, repeat: string): string | undefined {
  if (repeat === '') return 'Enter the new password again';
  if (repeat !== password) return 'The passwords don’t match';
  return undefined;
}

/** "New password" and "Repeat new password" (#2). The repeat is checked here, never sent. */
export function NewPasswordFields({
  password,
  repeat,
  onPassword,
  onRepeat,
  errors,
}: {
  password: string;
  repeat: string;
  onPassword: (v: string) => void;
  onRepeat: (v: string) => void;
  errors: { newPassword?: string | undefined; repeatPassword?: string | undefined };
}) {
  return (
    <>
      <Field
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        hint={`At least ${PASSWORD_MIN} characters.`}
        value={password}
        onChange={onPassword}
        error={errors.newPassword}
      />
      <Field
        label="Repeat new password"
        name="repeatPassword"
        type="password"
        autoComplete="new-password"
        value={repeat}
        onChange={onRepeat}
        error={errors.repeatPassword}
      />
    </>
  );
}
