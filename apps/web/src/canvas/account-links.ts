import { createContext, useContext } from 'react';

/** What a card's invite menu item offers: a new invite, the open one, or nothing. */
export type InviteState = 'new' | 'pending' | null;

/**
 * Which cards are someone's account, for the canvas's cards without threading it through the
 * layout (it changes when someone joins, the layout doesn't). The page provides it; outside one
 * (tests of a lone card) no card is linked and none offers an invite.
 */
export interface AccountLinks {
  /** The member linked to this person, unless it is you (your card says "You"). */
  linkedName(personId: string): string | null;
  /** `canAddRelative` stands for the inviter's scope: a steward invites inside their branch. */
  inviteState(person: { id: string; canAddRelative: boolean }): InviteState;
}

const NONE: AccountLinks = { linkedName: () => null, inviteState: () => null };
const Ctx = createContext<AccountLinks>(NONE);
export const AccountLinksProvider = Ctx.Provider;
export const useAccountLinks = () => useContext(Ctx);
