import type { GraphPerson, TreeGraph } from '@family-tree/shared';
import { type CSSProperties, type KeyboardEvent, useMemo } from 'react';
import { personName, personYears } from '../../trees/format';
import { clip, firstName, SvgAvatar } from '../svg-avatar';
import { descLayout } from './desc-layout';

/** Above this many people the tree gets crowded: say so, and draw it anyway. */
export const LARGE_TREE = 80;
const BRANCH_WIDTH = [22, 13, 8, 5];

const labelOf = (p: GraphPerson, extra?: string) =>
  [personName(p), personYears(p), extra].filter(Boolean).join(', ');

/**
 * The illustrated tree (Task 19): one person's descendants drawn as a real tree, the person at
 * the trunk, each generation higher up, partners hanging beside their person. Every leaf and
 * partner is a button that opens their panel. Drawn in tokens, so it follows the theme.
 */
export function IllustratedTree({
  graph,
  rootId,
  gens,
  selectedId,
  onOpen,
}: {
  graph: TreeGraph;
  rootId: string;
  gens: number;
  selectedId: string | null;
  onOpen: (personId: string) => void;
}) {
  const byId = useMemo(() => new Map(graph.persons.map((p) => [p.id, p])), [graph]);
  const layout = useMemo(() => descLayout(graph, rootId, gens), [graph, rootId, gens]);
  const root = byId.get(rootId);
  const rootNode = layout.nodes.find((n) => n.personId === rootId);
  if (!root || !rootNode) return null;
  const pos = new Map(layout.nodes.map((n) => [n.personId, n]));
  const { width: W, height: H } = layout;
  const tx = rootNode.x;
  const groundY = H - 26;
  const key = (id: string) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(id);
    }
  };
  const button = (p: GraphPerson, label: string) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    'data-person-id': p.id,
    className: p.id === selectedId ? 'tree-person is-selected' : 'tree-person',
    onClick: () => onOpen(p.id),
    onKeyDown: key(p.id),
  });

  return (
    <>
      {graph.persons.length > LARGE_TREE && (
        <p role="status" className="notice tree-notice">
          This branch is large. Lower Generations, or switch to the Focus or Full view.
        </p>
      )}
      <svg
        className="illustrated-tree"
        viewBox={`0 0 ${W.toFixed(0)} ${H.toFixed(0)}`}
        style={{ '--tree-width': `${Math.round(W)}px` } as CSSProperties}
        role="group"
        aria-label={`Illustrated tree of ${personName(root)}’s descendants`}
      >
        <ellipse
          className="tree-ground"
          cx={tx}
          cy={groundY + 4}
          rx={Math.max(60, Math.min(300, tx - 10, W - tx - 10))}
          ry={16}
        />
        <g className="tree-canopy" aria-hidden="true">
          {layout.nodes
            .filter((n) => n.gen >= 1)
            .map((n) => (
              <circle key={n.personId} cx={n.x + 10} cy={n.y - 6} r={n.gen === 1 ? 92 : 78} />
            ))}
        </g>
        <g aria-hidden="true">
          <path
            className="tree-bark"
            strokeWidth={44}
            d={`M${tx} ${groundY} C ${tx - 6} ${groundY - 40}, ${tx + 6} ${rootNode.y + 40}, ${tx} ${rootNode.y}`}
          />
          {[-90, -45, 50, 95].map((dx) => (
            <path
              key={dx}
              className="tree-bark"
              strokeWidth={9}
              d={`M${tx} ${groundY - 12} q ${dx * 0.4} 14 ${dx} 22`}
            />
          ))}
          {layout.branches.map((b) => {
            const from = pos.get(b.from)!;
            const to = pos.get(b.to)!;
            const [sx, sy, ex, ey] = [from.x, from.y - 10, to.x, to.y + 12];
            const my = (sy + ey) / 2;
            return (
              <path
                key={`${b.from}/${b.to}`}
                className="tree-bark tree-branch"
                strokeWidth={BRANCH_WIDTH[b.gen] ?? 4}
                d={`M${sx} ${sy} C ${sx} ${my}, ${ex} ${my + 20}, ${ex} ${ey}`}
              />
            );
          })}
        </g>
        {layout.nodes.map((n) => {
          const p = byId.get(n.personId)!;
          const r = n.gen === 0 ? 30 : 25;
          return (
            <g key={n.personId}>
              <g {...button(p, labelOf(p))}>
                <SvgAvatar person={p} cx={n.x} cy={n.y} r={r} />
                {p.id === selectedId && <circle className="tree-sel" cx={n.x} cy={n.y} r={r + 5} />}
                <text className="tree-name" x={n.x} y={n.y + r + 18} textAnchor="middle">
                  {clip(firstName(p), 14)}
                </text>
                <text className="tree-years" x={n.x} y={n.y + r + 32} textAnchor="middle">
                  {personYears(p)}
                </text>
              </g>
              {n.partners.map((at) => {
                const q = byId.get(at.id)!;
                return (
                  <g key={at.id} {...button(q, labelOf(q, `partner of ${personName(p)}`))}>
                    <SvgAvatar person={q} cx={at.x} cy={at.y} r={17} />
                    {q.id === selectedId && (
                      <circle className="tree-sel" cx={at.x} cy={at.y} r={21} />
                    )}
                    {/* One partner is named beside them; several, under each. */}
                    {n.partners.length === 1 ? (
                      <text className="tree-partner" x={at.x + 22} y={at.y + 4}>
                        {clip(firstName(q), 10)}
                      </text>
                    ) : (
                      <text className="tree-partner" x={at.x} y={at.y - 22} textAnchor="middle">
                        {clip(firstName(q), 7)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </>
  );
}
