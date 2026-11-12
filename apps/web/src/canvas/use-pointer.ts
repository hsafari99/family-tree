import { useSyncExternalStore } from 'react';

const QUERY = '(pointer: coarse)';

const media = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY)
    : null;

function subscribe(onChange: () => void) {
  const m = media();
  m?.addEventListener?.('change', onChange);
  return () => m?.removeEventListener?.('change', onChange);
}

/** Whether the main pointer is a finger (no hover): then a tap selects a card before its "+"s show. */
export function usePointerCoarse(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => media()?.matches ?? false,
    () => false,
  );
}
