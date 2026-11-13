import { afterEach, expect, it, vi } from 'vitest';
import {
  readCollapsed,
  readWhoamiDismissed,
  writeCollapsed,
  writeWhoamiDismissed,
} from './panel-state';

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

it('remembers a dismissed "Which one is you?" per tree, and survives a throwing storage', () => {
  expect(readWhoamiDismissed('t1')).toBe(false);
  writeWhoamiDismissed('t1');
  expect(readWhoamiDismissed('t1')).toBe(true);
  expect(readWhoamiDismissed('t2')).toBe(false);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(() => writeWhoamiDismissed('t2')).not.toThrow();
  expect(readWhoamiDismissed('t1')).toBe(false);
});
