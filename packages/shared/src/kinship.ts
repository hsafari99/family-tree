import { z } from 'zod';
import {
  type ChildKind,
  CHILD_KINDS,
  type UnionStatus,
  UNION_STATUSES,
  type UnionType,
  UNION_TYPES,
} from './people.js';
import { type Sex, SEXES } from './trees.js';

export const KIN_MOVES = ['parent', 'child', 'partner'] as const;
export type KinMove = (typeof KIN_MOVES)[number];

/** One step of a relationship path: from the previous person to `personId` (decision 20). */
export const kinStepSchema = z.object({
  move: z.enum(KIN_MOVES),
  personId: z.uuid(),
  sex: z.enum(SEXES),
  /** parent/child: the union the child belongs to; partner: the couple's union. */
  unionId: z.uuid(),
  /** parent and child moves only. */
  linkId: z.uuid().nullable(),
  kind: z.enum(CHILD_KINDS).nullable(),
  /** partner moves only. */
  unionType: z.enum(UNION_TYPES).nullable(),
  unionStatus: z.enum(UNION_STATUSES).nullable(),
  /**
   * A parent step onto a parents-unknown union (brief #11): personId is the union's id, not a
   * person. The child step that follows it is an ordinary one.
   */
  virtual: z.boolean().optional(),
});
export type KinStep = z.infer<typeof kinStepSchema>;

/** What pathfinding needs. The API's GraphRows fits as is; a web TreeGraph with links → parentChild. */
export interface KinGraph {
  persons: readonly { id: string; sex: Sex }[];
  unions: readonly {
    id: string;
    partnerAId: string | null;
    partnerBId: string | null;
    type: UnionType;
    status: UnionStatus;
    parentsUnknown?: boolean;
  }[];
  parentChild: readonly { id: string; unionId: string; childId: string; kind: ChildKind }[];
}

const MOVE_ORDER: Record<KinMove, number> = { parent: 0, child: 1, partner: 2 };

/** Outgoing steps per person: parents first, then children, then partners, each by id. */
function kinEdges(graph: KinGraph): Map<string, KinStep[]> {
  const sex = new Map(graph.persons.map((p) => [p.id, p.sex]));
  const unionById = new Map(graph.unions.map((u) => [u.id, u]));
  const out = new Map<string, KinStep[]>();
  const add = (from: string, step: KinStep) => {
    if (from === step.personId) return;
    const list = out.get(from);
    if (list) list.push(step);
    else out.set(from, [step]);
  };
  for (const l of graph.parentChild) {
    const u = unionById.get(l.unionId);
    const childSex = sex.get(l.childId);
    if (!u || childSex === undefined) continue;
    if (u.partnerAId === null && u.partnerBId === null && u.parentsUnknown) {
      // The union stands in for the unknown parents, so siblings still read as "sister".
      const link = {
        unionId: u.id,
        linkId: l.id,
        kind: l.kind,
        unionType: null,
        unionStatus: null,
      };
      // Only the step onto the union is virtual; the step down from it lands on a person.
      add(l.childId, { move: 'parent', personId: u.id, sex: 'unknown', ...link, virtual: true });
      add(u.id, { move: 'child', personId: l.childId, sex: childSex, ...link });
      continue;
    }
    for (const p of [u.partnerAId, u.partnerBId]) {
      const parentSex = p === null ? undefined : sex.get(p);
      if (p === null || parentSex === undefined) continue;
      const link = {
        unionId: u.id,
        linkId: l.id,
        kind: l.kind,
        unionType: null,
        unionStatus: null,
      };
      add(l.childId, { move: 'parent', personId: p, sex: parentSex, ...link });
      add(p, { move: 'child', personId: l.childId, sex: childSex, ...link });
    }
  }
  for (const u of graph.unions) {
    if (u.partnerAId === null || u.partnerBId === null) continue;
    const aSex = sex.get(u.partnerAId);
    const bSex = sex.get(u.partnerBId);
    if (aSex === undefined || bSex === undefined) continue;
    const couple = {
      move: 'partner' as const,
      unionId: u.id,
      linkId: null,
      kind: null,
      unionType: u.type,
      unionStatus: u.status,
    };
    add(u.partnerAId, { ...couple, personId: u.partnerBId, sex: bSex });
    add(u.partnerBId, { ...couple, personId: u.partnerAId, sex: aSex });
  }
  for (const list of out.values()) {
    list.sort(
      (a, b) =>
        MOVE_ORDER[a.move] - MOVE_ORDER[b.move] ||
        (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0),
    );
  }
  return out;
}

/**
 * Shortest paths from `fromId` over parent, child and partner edges, breadth first (spec §6).
 * The closest connection wins, not every connection: a shorter in-law path beats a longer blood
 * one, and at equal length the neighbour order (parents, children, partners) makes blood win.
 * Returns a lookup: the steps to a person, [] for `fromId` itself, null when not connected.
 */
export function kinPathsFrom(graph: KinGraph, fromId: string): (toId: string) => KinStep[] | null {
  const edges = kinEdges(graph);
  const prev = new Map<string, { from: string; step: KinStep } | null>([[fromId, null]]);
  const queue = [fromId];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const step of edges.get(id) ?? []) {
      if (prev.has(step.personId)) continue;
      prev.set(step.personId, { from: id, step });
      queue.push(step.personId);
    }
  }
  return (toId) => {
    if (!prev.has(toId)) return null;
    const steps: KinStep[] = [];
    for (let at = prev.get(toId); at; at = prev.get(at.from)) steps.unshift(at.step);
    return steps;
  };
}

export const relationshipPath = (graph: KinGraph, fromId: string, toId: string) =>
  kinPathsFrom(graph, fromId)(toId);

// ---- English wording (decision 21). The only place kinship words live. ----

const bySex = (sex: Sex, male: string, female: string, neutral: string) =>
  sex === 'male' ? male : sex === 'female' ? female : neutral;

const ORDINAL_WORDS = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
];
/** 1st, 2nd, 3rd, 4th, 11th, 21st … */
export function nth(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}
const ordinal = (n: number) => ORDINAL_WORDS[n - 1] ?? nth(n);
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
/** "", "great-", "great-great-", then "3rd great-" … */
const greats = (n: number) => (n <= 0 ? '' : n <= 2 ? 'great-'.repeat(n) : `${nth(n)} great-`);

/** One step, or a sibling: a parent step followed by a child step. */
type Chunk =
  | { kind: 'parent' | 'child' | 'partner'; step: KinStep }
  | { kind: 'sibling'; step: KinStep; up: KinStep; half: boolean };

function chunksOf(steps: readonly KinStep[]): Chunk[] {
  const out: Chunk[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const next = steps[i + 1];
    if (s.move === 'parent' && next?.move === 'child') {
      // Children of the same union are full siblings; through different unions, half.
      out.push({ kind: 'sibling', step: next, up: s, half: s.unionId !== next.unionId });
      i++;
    } else out.push({ kind: s.move, step: s });
  }
  return out;
}

/** Steps as the focus view counts them (Phase 5 decision 2): a half-sibling is two. */
export const closeRelativeSteps = (steps: readonly KinStep[]) =>
  chunksOf(steps).reduce((n, c) => n + (c.kind === 'sibling' && c.half ? 2 : 1), 0);

function parentWord(s: KinStep): string {
  const base = bySex(s.sex, 'father', 'mother', 'parent');
  if (s.kind === 'step') return bySex(s.sex, 'stepfather', 'stepmother', 'step-parent');
  if (s.kind === 'adoptive') return `adoptive ${base}`;
  if (s.kind === 'foster') return `foster ${base}`;
  return base;
}
function childWord(s: KinStep): string {
  const base = bySex(s.sex, 'son', 'daughter', 'child');
  if (s.kind === 'step') return bySex(s.sex, 'stepson', 'stepdaughter', 'stepchild');
  if (s.kind === 'adoptive') return `adopted ${base}`;
  if (s.kind === 'foster') return `foster ${base}`;
  return base;
}
function partnerWord(s: KinStep): string {
  const base = s.unionType === 'marriage' ? bySex(s.sex, 'husband', 'wife', 'spouse') : 'partner';
  return s.unionStatus === 'divorced' || s.unionStatus === 'separated' ? `former ${base}` : base;
}
function chunkWord(c: Chunk): string {
  switch (c.kind) {
    case 'parent':
      return parentWord(c.step);
    case 'child':
      return childWord(c.step);
    case 'partner':
      return partnerWord(c.step);
    case 'sibling': {
      // A step link on either side of the turn makes a step-sibling, not a full or half one.
      const viaStep = c.up.kind === 'step' || c.step.kind === 'step';
      const prefix = viaStep ? 'step' : c.half ? 'half-' : '';
      return `${prefix}${bySex(c.step.sex, 'brother', 'sister', 'sibling')}`;
    }
  }
}

/** "your father’s sister’s husband": the path in everyday words, from `possessive`’s side. */
export function kinshipChain(steps: readonly KinStep[], possessive: string): string {
  return `${possessive} ${chunksOf(steps).map(chunkWord).join('’s ')}`;
}

/** Blood relatives: `up` generations to the common ancestor, then `down` (not both 0). */
function bloodTerm(up: number, down: number, sex: Sex, half: boolean): string {
  const g = (male: string, female: string) => bySex(sex, male, female, `${female} or ${male}`);
  if (down === 0) return `${greats(up - 2)}grand${bySex(sex, 'father', 'mother', 'parent')}`;
  if (up === 0) return `${greats(down - 2)}grand${bySex(sex, 'son', 'daughter', 'child')}`;
  if (up === 1 && down === 1) {
    return `${half ? 'half-' : ''}${bySex(sex, 'brother', 'sister', 'sibling')}`;
  }
  if (down === 1 || up === 1) {
    const n = Math.max(up, down) - 2;
    const word =
      down === 1
        ? g(`${greats(n)}uncle`, `${greats(n)}aunt`)
        : g(`${greats(n)}nephew`, `${greats(n)}niece`);
    return half ? `${n > 0 ? 'half ' : 'half-'}${word}` : word;
  }
  const removed = Math.abs(up - down);
  const cousin = `${ordinal(Math.min(up, down) - 1)} cousin`;
  return `${half ? 'half ' : ''}${cousin}${removed ? ` ${times(removed)} removed` : ''}`;
}

const patternOf = (steps: readonly KinStep[]) =>
  steps.map((s) => (s.move === 'parent' ? 'U' : s.move === 'child' ? 'D' : 'P')).join('');

/**
 * The usual English name for the relationship ("second cousin once removed", "mother-in-law",
 * "uncle by marriage"), or null when English has none and only the chain describes it.
 */
export function kinshipTerm(steps: readonly KinStep[]): string | null {
  const last = steps.at(-1);
  if (!last) return null;
  if (steps.length === 1) return chunkWord({ kind: last.move, step: last });
  const sex = last.sex;
  const pattern = patternOf(steps);
  const blood = pattern.match(/^(U*)(D*)$/);
  if (blood) {
    const up = blood[1]!.length;
    const down = blood[2]!.length;
    // A step link anywhere makes a plain blood word wrong ("grandfather" for a stepfather's
    // father): only a step-sibling has a word, everything else uses the chain.
    if (steps.some((s) => s.kind === 'step')) {
      return up === 1 && down === 1
        ? bySex(sex, 'stepbrother', 'stepsister', 'step-sibling')
        : null;
    }
    const half = up > 0 && down > 0 && steps[up - 1]!.unionId !== steps[up]!.unionId;
    return bloodTerm(up, down, sex, half);
  }
  const term = relationByMarriage(pattern, sex);
  if (term === null) return null;
  // A divorce or separation on the way makes it a former relationship.
  const ended = steps.some(
    (s) => s.move === 'partner' && (s.unionStatus === 'divorced' || s.unionStatus === 'separated'),
  );
  return ended ? `former ${term}` : term;
}

/** In-laws, step-relatives and aunts or uncles by marriage: one partner step on the way. */
function relationByMarriage(pattern: string, sex: Sex): string | null {
  const word = (male: string, female: string, neutral: string) => bySex(sex, male, female, neutral);
  switch (pattern) {
    case 'PU':
      return word('father-in-law', 'mother-in-law', 'parent-in-law');
    case 'DP':
      return word('son-in-law', 'daughter-in-law', 'child-in-law');
    case 'PUD':
    case 'UDP':
      return word('brother-in-law', 'sister-in-law', 'sibling-in-law');
    case 'UP':
      return word('stepfather', 'stepmother', 'step-parent');
    case 'PD':
      return word('stepson', 'stepdaughter', 'stepchild');
    case 'UPD':
      return word('stepbrother', 'stepsister', 'step-sibling');
  }
  const byMarriage = pattern.match(/^(U{2,})DP$/);
  if (byMarriage) {
    const g = greats(byMarriage[1]!.length - 2);
    return `${word(`${g}uncle`, `${g}aunt`, `${g}aunt or ${g}uncle`)} by marriage`;
  }
  return null;
}
