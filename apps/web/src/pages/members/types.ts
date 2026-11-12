import { type AuthError, MESSAGES } from '../../auth/api';
import type { Member, PersonSummary, StewardGrant, TreeDetail } from '@family-tree/shared';

export interface Acted {
  n: number;
  from: 'reset' | 'invite' | null;
}

export type Part = 'tree' | 'persons' | 'members' | 'stewards' | 'invites';

/** What every section on the members page receives. */
export interface SectionProps {
  treeId: string;
  detail: TreeDetail;
  persons: PersonSummary[];
  members: Member[];
  stewards: StewardGrant[];
  /** The signed-in user's id. */
  me: string;
  reload: (...parts: Part[]) => Promise<void>;
  /** Which successful action last happened, so a section can drop link boxes that are now stale. */
  acted: Acted;
  /** Call after a successful action; `from` names a link box that action just created. */
  onActed: (from: Acted['from']) => void;
}

/** The message for a failed action: a missing member, grant or invite isn't "this tree". */
export const actionMessage = (e: AuthError) =>
  e.code === 'NOT_FOUND' ? MESSAGES.itemGone : e.message;
