/**
 * Ways to support the project, read from build variables so the links and the e-Transfer email
 * live in config, not code (a self-hosted copy shows none of them). Each is optional; with none
 * set, the app shows no Support link, menu item, home line or page.
 *
 * - VITE_DONATE_ETRANSFER_EMAIL: an Interac e-Transfer email (Canada), ideally one registered
 *   for Autodeposit, so donors aren't asked for a security question.
 * - VITE_DONATE_PAYPAL_URL: a PayPal.me link.
 * - VITE_DONATE_KOFI_URL: a Ko-fi page.
 */
export interface SupportConfig {
  etransferEmail: string | null;
  paypalUrl: string | null;
  kofiUrl: string | null;
}

type Env = Record<string, string | boolean | undefined>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function email(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return EMAIL.test(s) ? s : null;
}

/** Only an https link to the platform's own site counts: a typo can't send donors elsewhere. */
function link(v: unknown, hosts: string[]): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!URL.canParse(s)) return null;
  const u = new URL(s);
  const host = u.hostname.toLowerCase();
  const ok = u.protocol === 'https:' && hosts.some((h) => host === h || host.endsWith(`.${h}`));
  return ok ? u.toString() : null;
}

export function readSupport(env: Env): SupportConfig {
  return {
    etransferEmail: email(env.VITE_DONATE_ETRANSFER_EMAIL),
    paypalUrl: link(env.VITE_DONATE_PAYPAL_URL, ['paypal.me', 'paypal.com']),
    kofiUrl: link(env.VITE_DONATE_KOFI_URL, ['ko-fi.com']),
  };
}

export const hasSupport = (c: SupportConfig) =>
  c.etransferEmail !== null || c.paypalUrl !== null || c.kofiUrl !== null;

/** This build's support options. */
export const SUPPORT: SupportConfig = readSupport(import.meta.env as Env);

/** Where the Support link goes. */
export const SUPPORT_PATH = '/support';
