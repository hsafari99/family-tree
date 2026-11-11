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
