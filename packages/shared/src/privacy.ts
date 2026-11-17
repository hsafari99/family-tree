import { z } from 'zod';
import type { GraphLink, GraphUnion } from './family-graph.js';

/** Who in the tree sees a person's details (privacy spec D1). */
export const PRIVACY_LEVELS = ['public', 'branch', 'private'] as const;
export type PrivacyLevel = (typeof PRIVACY_LEVELS)[number];
export const PRIVACY_STEPS_MAX = 10;
export const RESTRICTED_NOTE = 'Data access is restricted';

export const privacySettingsSchema = z
  .object({
    level: z.enum(PRIVACY_LEVELS),
    /** Only for 'branch': how many steps away a member may be and still see the details. */
    steps: z
      .number()
      .int()
      .min(1, 'Choose at least 1 step')
      .max(PRIVACY_STEPS_MAX, `Choose at most ${PRIVACY_STEPS_MAX} steps`)
      .nullable(),
    hideBirthYear: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.level === 'branch' && v.steps === null) {
      ctx.addIssue({ code: 'custom', path: ['steps'], message: 'Choose how many steps' });
    }
  })
  .transform((v) => ({ ...v, steps: v.level === 'branch' ? v.steps : null }));
export type PrivacySettingsInput = z.input<typeof privacySettingsSchema>;
export type PrivacySettings = z.output<typeof privacySettingsSchema>;

/** GET/PUT …/me/privacy: the caller's own linked person and its settings. */
export const myPrivacySchema = z.object({
  personId: z.uuid().nullable(),
  settings: z.object({
    level: z.enum(PRIVACY_LEVELS),
    steps: z.number().int().nullable(),
    hideBirthYear: z.boolean(),
  }),
});
export type MyPrivacy = z.infer<typeof myPrivacySchema>;

/** What a viewer sees of a birthday whose year is hidden (privacy spec D8). */
export const birthdaySchema = z.object({
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31).nullable(),
});
export type Birthday = z.infer<typeof birthdaySchema>;

/**
 * How many steps each person is from `from` (privacy spec D5, R7), up to `max`. A step is a
 * parent, child, partner or sibling; siblings share a parent or a union, so a half-sibling is
 * one step too. Graph must hold live rows only.
 */
export function stepDistances(
  graph: { unions: readonly GraphUnion[]; parentChild: readonly GraphLink[] },
  from: string,
  max: number,
): Map<string, number> {
  const next = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    let s = next.get(a);
    if (!s) next.set(a, (s = new Set()));
    s.add(b);
  };
  const both = (a: string, b: string) => (link(a, b), link(b, a));
  const kids = new Map<string, string[]>();
  for (const l of graph.parentChild) {
    const list = kids.get(l.unionId);
    if (list) list.push(l.childId);
    else kids.set(l.unionId, [l.childId]);
  }
  /** Children of every union a partner is in: half-siblings included. */
  const childrenOfParent = new Map<string, Set<string>>();
  for (const u of graph.unions) {
    const partners = [u.partnerAId, u.partnerBId].filter((p): p is string => p !== null);
    const children = kids.get(u.id) ?? [];
    if (partners.length === 2) both(partners[0]!, partners[1]!);
    for (const p of partners) {
      for (const c of children) both(p, c);
      let s = childrenOfParent.get(p);
      if (!s) childrenOfParent.set(p, (s = new Set()));
      for (const c of children) s.add(c);
    }
    // Siblings with unknown parents share only the union (brief #11).
    for (const a of children) for (const b of children) link(a, b);
  }
  for (const siblings of childrenOfParent.values())
    for (const a of siblings) for (const b of siblings) link(a, b);

  const dist = new Map([[from, 0]]);
  let frontier = [from];
  for (let d = 1; d <= max && frontier.length > 0; d++) {
    const found: string[] = [];
    for (const id of frontier) {
      for (const n of next.get(id) ?? []) {
        if (!dist.has(n)) {
          dist.set(n, d);
          found.push(n);
        }
      }
    }
    frontier = found;
  }
  return dist;
}
