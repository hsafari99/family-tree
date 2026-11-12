import type { RelativeRole } from '@family-tree/shared';
import { createContext, useContext } from 'react';
import type { CardMenuActions } from './CardMenu';
import type { NavDirection } from './keyboard-nav';
import type { SelectionStore } from './selection';

/** What a card or dot can do; the canvas supplies `reveal`, `flyTo` and `move`, the page the rest. */
export interface CanvasActions extends CardMenuActions {
  openPerson(personId: string): void;
  addRelative(personId: string, as: RelativeRole): void;
  openUnion(unionId: string): void;
  /** Pans so the card is on screen (keyboard focus). */
  reveal(personId: string): void;
  /** Pans and zooms so the card is in the middle (search, "Centre on me"). */
  flyTo(personId: string): void;
  /** Moves keyboard focus to a relative's card (arrow keys). */
  move(personId: string, dir: NavDirection): void;
}
const Ctx = createContext<CanvasActions | null>(null);
const SelectionCtx = createContext<SelectionStore | null>(null);
/** The person whose panel is open; their card shows its "+" buttons without hover. */
export const SelectionProvider = SelectionCtx.Provider;
export function useSelectionStore(): SelectionStore {
  const store = useContext(SelectionCtx);
  if (!store) throw new Error('useSelectionStore must be used inside the canvas');
  return store;
}
export const CanvasActionsProvider = Ctx.Provider;
export function useCanvasActions(): CanvasActions {
  const actions = useContext(Ctx);
  if (!actions) throw new Error('useCanvasActions must be used inside the canvas');
  return actions;
}
