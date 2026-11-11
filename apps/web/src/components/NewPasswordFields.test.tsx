import { describe, expect, it } from 'vitest';
import { confirmError } from './NewPasswordFields';

describe('confirmError', () => {
  it('asks for the repeat, then for a match', () => {
    expect(confirmError('long-enough-1', '')).toBe('Enter the new password again');
    expect(confirmError('long-enough-1', 'long-enough-2')).toBe('The passwords don’t match');
    expect(confirmError('long-enough-1', 'long-enough-1')).toBeUndefined();
  });
});
