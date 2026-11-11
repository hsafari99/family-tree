import { Link } from 'react-router';
import type { SessionUser } from '../../auth/api';
import type { AccountSection } from '../AccountPage';

type NavItem = { id: AccountSection; label: string; status?: string; danger?: boolean };

/** The account settings' section list: each links to its page and shows a short status. */
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
    { id: 'profile', label: 'Profile', status: user.email },
    { id: 'password', label: 'Password', status: user.hasPassword ? 'Set' : 'Not set' },
    {
      id: 'two-step',
      label: 'Two-step verification',
      status: user.twoFactorEnabled ? '2FA on' : '2FA off',
    },
    ...(googleShown
      ? [
          {
            id: 'google' as const,
            label: 'Google',
            status: user.googleConnected ? 'Google connected' : 'Not connected',
          },
        ]
      : []),
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
              <span>{item.label}</span>{' '}
              {item.status && <span className="nav-status">{item.status}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
