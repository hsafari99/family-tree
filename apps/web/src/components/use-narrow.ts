import { useSyncExternalStore } from 'react';

/** The phone layout's breakpoint, as in styles.css. */
const QUERY = '(max-width: 720px)';

const media = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY)
    : null;

function subscribe(onChange: () => void) {
  const m = media();
  m?.addEventListener?.('change', onChange);
  return () => m?.removeEventListener?.('change', onChange);
}

/** Whether the page is at phone width (720px or less), kept up to date as it resizes. */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => media()?.matches ?? false,
    () => false,
  );
}
