import type { RelativeRole } from '@family-tree/shared';
import { createContext, useContext } from 'react';

/** What a card or dot can do; the canvas supplies `reveal`, the page the rest. */
export interface CanvasActions {
  openPerson(personId: string): void;
  addRelative(personId: string, as: RelativeRole): void;
  openUnion(unionId: string): void;
  /** Pans so the card is on screen (keyboard focus). */
  reveal(personId: string): void;
  /** The person whose panel is open; their card shows its "+" buttons without hover. */
  selectedId: string | null;
}
const Ctx = createContext<CanvasActions | null>(null);
export const CanvasActionsProvider = Ctx.Provider;
export function useCanvasActions(): CanvasActions {
  const actions = useContext(Ctx);
  if (!actions) throw new Error('useCanvasActions must be used inside the canvas');
  return actions;
}
