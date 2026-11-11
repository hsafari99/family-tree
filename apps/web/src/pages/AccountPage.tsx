import { useEffect, useRef } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import type { SessionUser } from '../auth/api';
import { useAuth } from '../auth/AuthContext';
import { useGoogleAvailability } from '../components/GoogleSignIn';
import { ArrowLeftIcon } from '../components/icons';
import { Page } from '../components/Page';
import { AccountNav } from './account/AccountNav';
import {
  DeleteSection,
  GoogleAccountSection,
  PasswordSection,
  ProfileSection,
  TwoStepSection,
} from './account/sections';

const SECTIONS = ['profile', 'password', 'two-step', 'google', 'delete'] as const;
export type AccountSection = (typeof SECTIONS)[number];

const isSection = (id: string): id is AccountSection =>
  (SECTIONS as readonly string[]).includes(id);

/**
 * Account settings: a section list on the left, one section on the right, each at
 * /account/:section. /account shows the profile (marked current) on desktop and only the list on
 * mobile; an unknown section goes back to /account.
 */
export function AccountPage() {
  const { user, refresh } = useAuth();
  const { section } = useParams();
  // Null until the server says whether Google sign-in is on.
  const googleEnabled = useGoogleAvailability();
  const sectionRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  // Joining a tree can change whether 2FA is required; don't trust a stale session.
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // Opening another section moves focus to its heading (visually hidden beside the nav), so
  // keyboard and screen-reader users land on the new content rather than staying in the list.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (section) sectionRef.current?.querySelector<HTMLElement>('h2')?.focus();
  }, [section]);
  // RequireAuth only renders this page for a signed-in user.
  if (user === null || user === 'loading') return null;
  // An unknown section (an old or mistyped link) falls back to the default one.
  if (section !== undefined && !isSection(section)) return <Navigate to="/account" replace />;
  const current: AccountSection = section ?? 'profile';
  const googleShown = googleEnabled === true || user.googleConnected;

  return (
    <Page
      title="Account"
      wide
      back={
        <Link to="/" className="icon-link" aria-label="Back to home" title="Back to home">
          <ArrowLeftIcon />
        </Link>
      }
    >
      <div className={section ? 'account-layout has-section' : 'account-layout'}>
        <AccountNav user={user} current={current} googleShown={googleShown} />
        <div className="account-section" ref={sectionRef}>
          {section && (
            <p className="account-back">
              <Link to="/account">Back to account</Link>
            </p>
          )}
          <SectionBody id={current} user={user} refresh={refresh} googleEnabled={googleEnabled} />
        </div>
      </div>
    </Page>
  );
}

function SectionBody({
  id,
  user,
  refresh,
  googleEnabled,
}: {
  id: AccountSection;
  user: SessionUser;
  refresh: () => Promise<void>;
  googleEnabled: boolean | null;
}) {
  switch (id) {
    case 'profile':
      return <ProfileSection user={user} />;
    case 'password':
      return <PasswordSection user={user} refresh={refresh} />;
    case 'two-step':
      return <TwoStepSection user={user} refresh={refresh} />;
    case 'google':
      return <GoogleAccountSection user={user} refresh={refresh} enabled={googleEnabled} />;
    case 'delete':
      return <DeleteSection user={user} />;
  }
}
