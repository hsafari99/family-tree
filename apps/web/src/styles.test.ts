import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// jsdom gives import.meta.url a non-file scheme, and Vitest blanks CSS imports, so read the
// sheet from disk (Vitest runs from the package directory).
const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

describe('global form styles', () => {
  it('gives select and textarea the same box as input', () => {
    expect(css).toMatch(/input,\s*select,\s*textarea\s*\{[^}]*padding: 0\.6rem 0\.7rem/);
    expect(css).toMatch(/select\s*\{[^}]*min-height: 2\.75rem/);
  });
  it('spaces a button or action row that follows a field outside a form grid', () => {
    expect(css).toContain(':not(form) > .field + :is(button, .confirm, .actions)');
  });
  it("keeps a form's direct buttons at their own width instead of the grid's", () => {
    expect(css).toMatch(/form > :is\(button, \.confirm\)\s*\{[^}]*justify-self: start/);
  });
});

describe('password toggle', () => {
  it('sits inside the input on its right edge, with room kept for it', () => {
    expect(css).toMatch(/\.password-input\s*\{[^}]*position: relative/);
    expect(css).toMatch(/\.password-input input\s*\{[^}]*padding-right: 2\.75rem/);
    expect(css).toMatch(/\.password-toggle\s*\{[^}]*position: absolute[^}]*right:/);
  });
  it('is at least 24px square, uses currentColor, and keeps a focus ring', () => {
    const rule = css.match(/\.password-toggle\s*\{([^}]*)\}/)![1]!;
    expect(rule).toMatch(/min-width: 2rem/);
    expect(rule).toMatch(/min-height: 2rem/);
    expect(rule).toMatch(/color: (inherit|currentColor|var\(--muted\))/);
    expect(rule).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(css).toMatch(
      /\.password-toggle:focus-visible\s*\{[^}]*outline: 3px solid var\(--accent\)/,
    );
  });
});

describe('global header', () => {
  it('hides the skip link off screen until it has focus', () => {
    expect(css).toMatch(
      /\.skip-link\s*\{[^}]*position: absolute[^}]*transform: translateY\(-200%\)/,
    );
    expect(css).toMatch(/\.skip-link:focus\s*\{[^}]*transform: none/);
  });
  it('truncates a long tree name instead of widening the page', () => {
    const rule = css.match(/\.app-header-tree\s*\{([^}]*)\}/)![1]!;
    expect(rule).toMatch(/min-width: 0/);
    expect(rule).toMatch(/text-overflow: ellipsis/);
    expect(css).toMatch(/\.app-header-place\s*\{[^}]*min-width: 0/);
  });
  it('shows only the picture for the account menu on a phone', () => {
    expect(css).toMatch(
      /@media \(max-width: 720px\)\s*\{[^@]*\.account-trigger-name\s*\{\s*display: none/,
    );
  });
});

describe('design tokens', () => {
  // The first :root block is the light set; the one inside the dark media query redefines it.
  const light = css.match(/^:root\s*\{([^}]*)\}/m)![1]!;
  const dark = css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/)![1]!;
  const declared = (block: string) =>
    new Set([...block.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));
  const colourTokens = [
    '--bg',
    '--surface',
    '--surface-2',
    '--ink',
    '--ink-2',
    '--line',
    '--line-strong',
    '--accent',
    '--accent-ink',
    '--accent-soft',
    '--ring',
    '--pat',
    '--mat',
    '--bark',
    '--canopy',
    '--av1',
    '--av2',
    '--av3',
    '--av4',
    '--av5',
    '--av6',
    '--av-ink',
    '--success',
    '--danger',
    '--warning',
  ];
  const otherTokens = [
    '--radius-s',
    '--radius',
    '--radius-l',
    '--radius-pill',
    '--shadow-1',
    '--shadow-2',
    '--shadow-3',
    '--space-1',
    '--space-2',
    '--space-3',
    '--space-4',
    '--space-5',
    '--space-6',
    '--space-7',
    '--font',
    '--text-xs',
    '--text-s',
    '--text-m',
    '--text-l',
    '--text-xl',
    '--text-2xl',
    '--ease',
    '--dur',
    // old names, kept as aliases
    '--muted',
    '--border',
    '--ok',
    '--bad',
  ];

  it('defines every token on :root', () => {
    const names = declared(light);
    for (const t of [...colourTokens, ...otherTokens]) expect(names, t).toContain(t);
  });
  it('redefines every colour token for dark mode', () => {
    const names = declared(dark);
    for (const t of colourTokens) expect(names, t).toContain(t);
  });
  it('maps the main tokens to system colours in forced-colors mode', () => {
    expect(css).toMatch(
      /@media \(forced-colors: active\)\s*\{\s*:root\s*\{[^}]*--accent: LinkText/,
    );
  });
  it('has no literal white outside the tokens and the QR code', () => {
    const rest = css.replace(/:root\s*\{[^}]*\}/g, '').replace(/\.qr\s*\{[^}]*\}/g, '');
    expect(rest).not.toMatch(/#fff(fff)?\b/i);
    expect(rest).not.toMatch(/\bwhite\b(?!-)/i);
  });
});

describe('base styles', () => {
  it('sets the page colours and type from the tokens', () => {
    const body = css.match(/(?:^|\n)body\s*\{([^}]*)\}/)![1]!;
    expect(body).toMatch(/background: var\(--bg\)/);
    expect(body).toMatch(/color: var\(--ink\)/);
    expect(body).toMatch(/font: 400 var\(--text-m\)\/1\.55 var\(--font\)/);
  });
  it('tightens and balances headings', () => {
    expect(css).toMatch(
      /h1,\s*h2,\s*h3,\s*h4\s*\{[^}]*letter-spacing: -0\.01em[^}]*text-wrap: balance/,
    );
  });
  it('draws links and the focus ring in the accent', () => {
    expect(css).toMatch(/(?:^|\n)a\s*\{[^}]*color: var\(--accent\)/);
    expect(css).toMatch(
      /(?:^|\n):focus-visible\s*\{[^}]*outline: 2px solid var\(--accent\);[^}]*outline-offset: 2px/,
    );
  });
  it('uses tabular figures in tables', () => {
    expect(css).toMatch(/(?:^|\n)table\s*\{[^}]*font-variant-numeric: tabular-nums/);
  });
});
