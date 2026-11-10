import { useSyncExternalStore } from 'react';

/**
 * Which person is selected, as a tiny store. A card subscribes to "am I the selected one?", so a
 * selection change re-renders two cards, not every card on the canvas.
 */
export interface SelectionStore {
  get(): string | null;
  set(id: string | null): void;
  subscribe(listener: () => void): () => void;
}

export function createSelectionStore(initial: string | null = null): SelectionStore {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(id) {
      if (id === current) return;
      current = id;
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export function useIsSelected(store: SelectionStore, personId: string): boolean {
  return useSyncExternalStore(store.subscribe, () => store.get() === personId);
}
