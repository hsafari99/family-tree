import { Link } from 'react-router';
import { Success } from '../components/forms';

export function PasswordChanged() {
  return (
    <Success>
      <p>Password changed — sign in with your new password</p>
      <p>
        <Link to="/sign-in">Sign in</Link>
      </p>
    </Success>
  );
}
