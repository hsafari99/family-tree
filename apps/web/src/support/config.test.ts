import { describe, expect, it } from 'vitest';
import { hasSupport, readSupport } from './config';

describe('readSupport', () => {
  it('reads each option, trimmed', () => {
    const c = readSupport({
      VITE_DONATE_ETRANSFER_EMAIL: '  give@example.com ',
      VITE_DONATE_PAYPAL_URL: 'https://paypal.me/someone',
      VITE_DONATE_KOFI_URL: 'https://ko-fi.com/someone',
      VITE_DONATE_BMAC_URL: 'https://buymeacoffee.com/someone',
    });
    expect(c).toEqual({
      etransferEmail: 'give@example.com',
      paypalUrl: 'https://paypal.me/someone',
      kofiUrl: 'https://ko-fi.com/someone',
      bmacUrl: 'https://buymeacoffee.com/someone',
    });
    expect(hasSupport(c)).toBe(true);
  });

  it('has nothing when unset or empty', () => {
    const c = readSupport({ VITE_DONATE_ETRANSFER_EMAIL: '' });
    expect(c).toEqual({ etransferEmail: null, paypalUrl: null, kofiUrl: null, bmacUrl: null });
    expect(hasSupport(c)).toBe(false);
    expect(hasSupport(readSupport({ VITE_DONATE_BMAC_URL: 'https://buymeacoffee.com/x' }))).toBe(
      true,
    );
  });

  it('drops a malformed email and links that are not https or not the platform', () => {
    const c = readSupport({
      VITE_DONATE_ETRANSFER_EMAIL: 'not an email',
      VITE_DONATE_PAYPAL_URL: 'http://paypal.me/someone',
      VITE_DONATE_KOFI_URL: 'https://ko-fi.com.evil.example/someone',
      VITE_DONATE_BMAC_URL: 'https://buymeacoffee.com.evil.example/someone',
    });
    expect(c).toEqual({ etransferEmail: null, paypalUrl: null, kofiUrl: null, bmacUrl: null });
    expect(
      readSupport({ VITE_DONATE_PAYPAL_URL: 'https://www.paypal.com/donate/x' }).paypalUrl,
    ).toBe('https://www.paypal.com/donate/x');
  });
});
