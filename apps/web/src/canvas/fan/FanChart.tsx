import type { GraphPerson, RelativeRole, TreeGraph } from '@family-tree/shared';
import { type KeyboardEvent, useMemo, useRef } from 'react';
import { personName, personYears } from '../../trees/format';
import { clip, firstName, SvgAvatar } from '../svg-avatar';
import { ahnentafel, slotRelation } from './ahnentafel';
import { fanGeometry, fanRadius, type FanSlot } from './fan-geometry';

const R0 = 72;
const RING = 86;
const PAD = 8;
/** The fan dips 10° below the horizontal on each side. */
const DIP = Math.sin((10 * Math.PI) / 180);
/** How strongly each ring takes its side's colour (the rest is the surface), by generation. */
const TINT = [0, 62, 52, 44, 38, 33, 29];

const labelOf = (p: GraphPerson, relation?: string) =>
  [personName(p), personYears(p), relation].filter(Boolean).join(', ');

/** The text inside a segment: name and years near the middle, first names only far out. */
function SegmentText({ slot, person }: { slot: FanSlot; person: GraphPerson }) {
  const first = firstName(person);
  const g = slot.gen;
  const lines: [string, string, number][] =
    g <= 2
      ? [
          [clip(first, g === 1 ? 16 : 12), 'fan-t', -3],
          [personYears(person), 'fan-s', 12],
        ]
      : g === 3
        ? [
            [clip(first, 11), 'fan-t', -2],
            [person.birthYear?.toString() ?? '', 'fan-s', 11],
          ]
        : [[clip(first, g === 4 ? 11 : 9), g === 4 ? 'fan-s' : 'fan-xs', 3.5]];
  return (
    <g
      transform={`translate(${slot.labelX.toFixed(1)} ${slot.labelY.toFixed(1)}) rotate(${slot.rotate.toFixed(1)})`}
    >
      {lines.map(([t, c, dy]) =>
        t ? (
          <text key={c} className={c} y={dy} textAnchor="middle">
            {t}
          </text>
        ) : null,
      )}
    </g>
  );
}

/**
 * The fan chart (Task 18): the person in the middle, their ancestors in rings around them, the
 * father's side on the left in `--pat` and the mother's on the right in `--mat`. Each person is a
 * button: click or Enter opens their panel, a double-click re-centres the fan on them. Empty slots
 * are dashed; where the child may get a parent, they offer "+ Add".
 */
export function FanChart({
  graph,
  rootId,
  gens,
  selectedId,
  onOpen,
  onAdd,
  onRecentre,
}: {
  graph: TreeGraph;
  rootId: string;
  gens: number;
  selectedId: string | null;
  onOpen: (personId: string) => void;
  onAdd: (childId: string, as: RelativeRole) => void;
  onRecentre: (personId: string) => void;
}) {
  const byId = useMemo(() => new Map(graph.persons.map((p) => [p.id, p])), [graph]);
  const slots = useMemo(() => ahnentafel(graph, rootId, gens), [graph, rootId, gens]);
  const R = fanRadius(gens, R0, RING);
  const cx = R + PAD;
  const cy = R + PAD;
  const geometry = useMemo(() => fanGeometry({ gens, cx, cy, r0: R0, ring: RING }), [gens, cx, cy]);
  const refs = useRef(new Map<number, SVGGElement>());
  const root = byId.get(rootId);
  if (!root) return null;
  const width = 2 * (R + PAD);
  const height = R + PAD + Math.max(R * DIP, 64) + PAD;

  /** Focus slot `n`, or the nearest focusable one in the same ring in direction `step`. */
  const focusSlot = (n: number, step = 0) => {
    const g = Math.floor(Math.log2(n));
    for (let m = n; m >= 2 ** g && m < 2 ** (g + 1); m += step || 1) {
      const el = refs.current.get(m);
      if (el) return void el.focus();
      if (step === 0) break;
    }
  };
  const onKey = (n: number, id: string | null) => (e: KeyboardEvent<SVGGElement>) => {
    const moves: Record<string, () => void> = {
      ArrowLeft: () => focusSlot(n - 1, -1),
      ArrowRight: () => focusSlot(n + 1, 1),
      // Outward to the father's slot (else the mother's), inward to the child's.
      ArrowUp: () => (refs.current.has(2 * n) ? focusSlot(2 * n) : focusSlot(2 * n + 1)),
      ArrowDown: () => n > 1 && focusSlot(n >> 1),
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      if (n > 1 || e.key === 'ArrowUp') move();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && id) {
      e.preventDefault();
      onOpen(id);
    }
  };
  const setRef = (n: number) => (el: SVGGElement | null) => {
    if (el) refs.current.set(n, el);
    else refs.current.delete(n);
  };

  return (
    <svg
      className="fan-chart"
      viewBox={`0 0 ${width.toFixed(0)} ${height.toFixed(0)}`}
      role="group"
      aria-label={`Fan chart of ${personName(root)}’s ancestors`}
    >
      {geometry.map((slot) => {
        const id = slots.get(slot.n);
        const person = id ? byId.get(id) : undefined;
        if (!person) {
          const child = byId.get(slots.get(slot.n >> 1) ?? '');
          const canAdd = child?.canAddRelative === true;
          const seg = <path className="fan-seg is-empty" d={slot.path} />;
          if (!child || !canAdd) return <g key={slot.n}>{seg}</g>;
          return (
            <g
              key={slot.n}
              ref={setRef(slot.n)}
              className="fan-slot fan-add"
              role="button"
              tabIndex={0}
              aria-label={`Add a parent of ${personName(child)}`}
              onClick={() => onAdd(child.id, 'parent')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onAdd(child.id, 'parent');
                } else onKey(slot.n, null)(e);
              }}
            >
              {seg}
              <g
                transform={`translate(${slot.labelX.toFixed(1)} ${slot.labelY.toFixed(1)}) rotate(${slot.rotate.toFixed(1)})`}
              >
                <text className="fan-add-t" y={4} textAnchor="middle">
                  {slot.gen <= 3 ? '+ Add' : '+'}
                </text>
              </g>
            </g>
          );
        }
        const selected = person.id === selectedId;
        return (
          <g
            key={slot.n}
            ref={setRef(slot.n)}
            className={selected ? 'fan-slot is-selected' : 'fan-slot'}
            role="button"
            tabIndex={0}
            aria-label={labelOf(person, slotRelation(slot.n, person.sex))}
            data-person-id={person.id}
            onClick={() => onOpen(person.id)}
            onDoubleClick={() => onRecentre(person.id)}
            onKeyDown={onKey(slot.n, person.id)}
          >
            <path
              className={`fan-seg is-${slot.side}`}
              d={slot.path}
              style={{
                fill: `color-mix(in srgb, var(--${slot.side}) ${TINT[slot.gen] ?? 29}%, var(--surface))`,
              }}
            />
            <SegmentText slot={slot} person={person} />
          </g>
        );
      })}
      {/* The selection's ring, over the neighbours, so no segment hides half of it. */}
      {geometry
        .filter((slot) => selectedId !== null && slots.get(slot.n) === selectedId)
        .map((slot) => (
          <path key="sel" className="fan-sel" d={slot.path} aria-hidden="true" />
        ))}
      <g
        ref={setRef(1)}
        className={
          root.id === selectedId ? 'fan-slot fan-centre is-selected' : 'fan-slot fan-centre'
        }
        role="button"
        tabIndex={0}
        aria-label={labelOf(root)}
        data-person-id={root.id}
        onClick={() => onOpen(root.id)}
        onKeyDown={onKey(1, root.id)}
      >
        <circle className="fan-hub" cx={cx} cy={cy - 6} r={R0 - 4} />
        <SvgAvatar person={root} cx={cx} cy={cy - 12} r={34} />
        {root.id === selectedId && <circle className="fan-sel" cx={cx} cy={cy - 12} r={39} />}
        <text className="fan-root-name" x={cx} y={cy + 42} textAnchor="middle">
          {clip(firstName(root), 14)}
        </text>
      </g>
    </svg>
  );
}
