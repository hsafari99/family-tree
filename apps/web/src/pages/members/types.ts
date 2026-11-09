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
