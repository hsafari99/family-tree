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
