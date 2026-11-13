import { Navigate } from 'react-router';
import { HeartIcon } from '../components/icons';
import { Page } from '../components/Page';
import { hasSupport } from '../support/config';
import { useSupport } from '../support/SupportContext';
import { CopyLink } from './members/CopyLink';

/**
 * Support Family Tree: why it asks, then each way this build offers (Interac e-Transfer, PayPal,
 * Ko-fi), plainly worded for people who don't do this often. Payment happens on the bank's or the
 * platform's own site; this app never sees it. With no option set, the page doesn't exist.
 */
export function SupportPage() {
  const support = useSupport();
  if (!hasSupport(support)) return <Navigate to="/" replace />;
  const { etransferEmail, paypalUrl, kofiUrl } = support;
  return (
    <Page title="Support Family Tree">
      <p className="support-lead">
        <HeartIcon /> Family Tree is free and open source. If it helps your family, a donation helps
        pay for hosting and photo storage and keeps it free for everyone. Thank you!
      </p>
      <p className="hint">Every donation is optional and goes to the person who runs this app.</p>

      {etransferEmail && (
        <section aria-labelledby="support-etransfer" className="support-option">
          <h2 id="support-etransfer">Interac e-Transfer (Canada)</h2>
          <ol className="support-steps">
            <li>Open your bank’s app or website.</li>
            <li>
              Choose <strong>Interac e-Transfer</strong> (sometimes under <em>Send money</em>).
            </li>
            <li>Send any amount you like to this email:</li>
          </ol>
          <CopyLink label="e-Transfer email" url={etransferEmail} />
          <p className="hint">
            It goes in automatically, so you won’t be asked for a security question or answer.
          </p>
        </section>
      )}

      {(paypalUrl || kofiUrl) && (
        <section aria-labelledby="support-online" className="support-option">
          <h2 id="support-online">Online, by card or PayPal</h2>
          <p>Opens in a new tab. You can pay with a card; you don’t need an account.</p>
          <p className="support-links">
            {paypalUrl && (
              <a className="button-link" href={paypalUrl} target="_blank" rel="noopener noreferrer">
                Donate with PayPal
              </a>
            )}
            {kofiUrl && (
              <a className="button-link" href={kofiUrl} target="_blank" rel="noopener noreferrer">
                Donate on Ko-fi
              </a>
            )}
          </p>
        </section>
      )}
    </Page>
  );
}
