import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { hiddenBranchesKey, useHiddenBranches } from './useHiddenBranches';

afterEach(() => localStorage.clear());

describe('useHiddenBranches', () => {
  it('toggles and remembers per tree', () => {
    const { result, unmount } = renderHook(() => useHiddenBranches('t1'));
    act(() => result.current.toggle('a'));
    expect([...result.current.hidden]).toEqual(['a']);
    expect(localStorage.getItem(hiddenBranchesKey('t1'))).toBe('["a"]');
    unmount();
    const again = renderHook(() => useHiddenBranches('t1'));
    expect(again.result.current.hidden.has('a')).toBe(true);
    act(() => again.result.current.toggle('a'));
    expect(again.result.current.hidden.size).toBe(0);
    expect(localStorage.getItem(hiddenBranchesKey('t1'))).toBeNull();
    expect(renderHook(() => useHiddenBranches('t2')).result.current.hidden.size).toBe(0);
  });

  it('ignores junk in storage, and show() expands', () => {
    localStorage.setItem(hiddenBranchesKey('t1'), '{"x":1}');
    expect(renderHook(() => useHiddenBranches('t1')).result.current.hidden.size).toBe(0);
    localStorage.setItem(hiddenBranchesKey('t1'), '["a","b",3]');
    const { result } = renderHook(() => useHiddenBranches('t1'));
    expect([...result.current.hidden]).toEqual(['a', 'b']);
    act(() => result.current.show(['a']));
    expect([...result.current.hidden]).toEqual(['b']);
  });
});
