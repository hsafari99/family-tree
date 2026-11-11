import { afterEach, expect, it, vi } from 'vitest';
import { readCollapsed, writeCollapsed } from './panel-state';

afterEach(() => vi.restoreAllMocks());

it('round-trips and survives a throwing storage', () => {
  writeCollapsed(true);
  expect(readCollapsed()).toBe(true);
  writeCollapsed(false);
  expect(readCollapsed()).toBe(false);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(() => writeCollapsed(true)).not.toThrow();
  expect(readCollapsed()).toBe(false);
});
