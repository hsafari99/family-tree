import type { Page } from '@playwright/test';

/** Collects CSP violations: `securitypolicyviolation` events and console reports. */
export async function watchCsp(page: Page) {
  const logged: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) logged.push(m.text());
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  return {
    async violations(): Promise<string[]> {
      const seen = await page.evaluate(
        () => (window as unknown as { __csp?: string[] }).__csp ?? [],
      );
      return [...logged, ...seen];
    },
  };
}
