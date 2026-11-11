import { describe, expect, it } from 'vitest';
import { safeWebPath } from './google.js';

const WEB = 'https://family.example.com';

describe('safeWebPath', () => {
  it('keeps a path, query and hash on the web origin', () => {
    expect(safeWebPath(`${WEB}/`, WEB)).toBe('/');
    expect(safeWebPath(`${WEB}/invite/abc?x=1#top`, WEB)).toBe('/invite/abc?x=1#top');
  });

  it.each([
    ['another origin', 'https://evil.example/invite/abc'],
    ['a look-alike host', 'https://family.example.com.evil.example/'],
    ['another scheme', 'http://family.example.com/'],
    ['another port', 'https://family.example.com:8443/'],
    ['a relative path', '/invite/abc'],
    ['a protocol-relative URL', '//evil.example/'],
    ['a doubled slash path', `${WEB}//evil.example/`],
    ['a backslash', `${WEB}/\\evil.example`],
    ['a control character', `${WEB}/\t/evil.example`],
    ['credentials', 'https://user:pw@family.example.com/'],
    ['javascript:', 'javascript:alert(1)'],
    ['garbage', 'not a url'],
  ])('rejects %s', (_label, value) => {
    expect(safeWebPath(value, WEB)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(safeWebPath(undefined, WEB)).toBeNull();
    expect(safeWebPath(42, WEB)).toBeNull();
  });
});
