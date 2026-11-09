import { Link } from 'react-router';
import { Page } from '../components/Page';

export function NotFoundPage() {
  return (
    <Page title="Page not found">
      <p>There is nothing at this address.</p>
      <p>
        <Link to="/">Go to the home page</Link>
      </p>
    </Page>
  );
}
