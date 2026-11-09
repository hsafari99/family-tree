import { type AuthError, MESSAGES } from '../../auth/api';
import type { Member, PersonSummary, TreeDetail } from '@family-tree/shared';

export type Part = 'tree' | 'persons' | 'members' | 'stewards' | 'invites';

/** What every section on the members page receives. */
export interface SectionProps {
  treeId: string;
  detail: TreeDetail;
  persons: PersonSummary[];
  members: Member[];
  /** The signed-in user's id. */
  me: string;
  reload: (...parts: Part[]) => Promise<void>;
}

/** The message for a failed action: a missing member, grant or invite isn't "this tree". */
export const actionMessage = (e: AuthError) =>
  e.code === 'NOT_FOUND' ? MESSAGES.itemGone : e.message;
