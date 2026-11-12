import type { Edge } from '@xyflow/react';
import type { CanvasNode, Family } from './graph-to-flow';
import type { PathHighlight } from './highlight';

/**
 * The selected person's direct line (Task 7): them, every ancestor (up through the families they
 * are a child in) and every descendant (down through the families they are a partner in), with the
 * unions and lines on those routes. A partner is not on the line, but the union they share is.
 */
export function lineage(families: readonly Family[], personId: string): PathHighlight {
  const personIds = new Set([personId]);
  const unionIds = new Set<string>();
  const edgeIds = new Set<string>();
  const asChild = new Map<string, Family[]>();
  const asPartner = new Map<string, Family[]>();
  for (const f of families) {
    for (const c of f.childIds) asChild.set(c, [...(asChild.get(c) ?? []), f]);
    for (const p of f.partnerIds) asPartner.set(p, [...(asPartner.get(p) ?? []), f]);
  }
  const linkOf = (f: Family, childId: string) =>
    f.childLinks.find((l) => l.childId === childId)?.linkId;

  // Up: each parent once (a visited set, so a cycle in bad data can't loop).
  const up = [personId];
  const seenUp = new Set(up);
  while (up.length > 0) {
    const child = up.pop()!;
    for (const f of asChild.get(child) ?? []) {
      unionIds.add(f.id);
      const link = linkOf(f, child);
      if (link) edgeIds.add(`child:${link}`);
      for (const p of f.partnerIds) {
        personIds.add(p);
        edgeIds.add(`partner:${f.id}:${p}`);
        if (!seenUp.has(p)) {
          seenUp.add(p);
          up.push(p);
        }
      }
    }
  }
  // Down: each child once.
  const down = [personId];
  const seenDown = new Set(down);
  while (down.length > 0) {
    const parent = down.pop()!;
    for (const f of asPartner.get(parent) ?? []) {
      unionIds.add(f.id);
      edgeIds.add(`partner:${f.id}:${parent}`);
      for (const { childId, linkId } of f.childLinks) {
        personIds.add(childId);
        edgeIds.add(`child:${linkId}`);
        if (!seenDown.has(childId)) {
          seenDown.add(childId);
          down.push(childId);
        }
      }
    }
  }
  return { personIds, unionIds, edgeIds };
}

const withClass = (cls: string | undefined, add: string) => (cls ? `${cls} ${add}` : add);

/** Marks the line (`is-line`, `edge-line`) and dims the rest (`is-dim`, `edge-dim`); no re-layout. */
export function applyLineage(nodes: CanvasNode[], edges: Edge[], h: PathHighlight) {
  return {
    nodes: nodes.map((n) => {
      const on =
        n.type === 'person' ? h.personIds.has(n.data.person.id) : h.unionIds.has(n.data.union.id);
      return { ...n, className: withClass(n.className, on ? 'is-line' : 'is-dim') };
    }),
    edges: edges.map((e) => ({
      ...e,
      className: withClass(e.className, h.edgeIds.has(e.id) ? 'edge-line' : 'edge-dim'),
    })),
  };
}
