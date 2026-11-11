import { Link } from 'react-router';
import type { SessionUser } from '../../auth/api';
import type { AccountSection } from '../AccountPage';
import { passwordLabel } from './sections';

type NavItem = { id: AccountSection; label: string; danger?: boolean };

/** The account settings' section list: one short label per section, each its own page. */
export function AccountNav({
  user,
  current,
  googleShown,
}: {
  user: SessionUser;
  current: AccountSection;
  googleShown: boolean;
}) {
  const items: NavItem[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'password', label: passwordLabel(user) },
    { id: 'two-step', label: 'Two-step verification' },
    ...(googleShown ? [{ id: 'google' as const, label: 'Google sign-in' }] : []),
    { id: 'delete', label: 'Delete account', danger: true },
  ];
  return (
    <nav aria-label="Account settings">
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <Link
              to={`/account/${item.id}`}
              aria-current={item.id === current ? 'page' : undefined}
              className={item.danger ? 'danger' : undefined}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
