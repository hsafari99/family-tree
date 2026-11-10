import type { GraphPerson, RelativeRole } from '@family-tree/shared';
import { Handle, type NodeProps, Position, type ReactFlowState, useStore } from '@xyflow/react';
import { initials, personName, personYears } from '../trees/format';
import { type CardDetail, cardDetail } from './canvas-settings';
import { useCanvasActions, useSelectionStore } from './CanvasActions';
import { useIsSelected } from './selection';
import type { PersonFlowNode } from './graph-to-flow';

const ADD: { as: RelativeRole; where: 'top' | 'left' | 'right' | 'bottom'; word: string }[] = [
  { as: 'parent', where: 'top', word: 'parent' },
  { as: 'sibling', where: 'left', word: 'sibling' },
  { as: 'partner', where: 'right', word: 'partner' },
  { as: 'child', where: 'bottom', word: 'child' },
];

export function PersonCardView({
  person,
  detail,
  isFocus,
  isMe,
  isSelected = false,
  onOpen,
  onAdd,
  onFocus,
}: {
  person: GraphPerson;
  detail: CardDetail;
  isFocus: boolean;
  isMe: boolean;
  isSelected?: boolean;
  onOpen: () => void;
  onAdd: (as: RelativeRole) => void;
  onFocus?: () => void;
}) {
  const name = personName(person);
  const years = personYears(person);
  const deceased = !person.isLiving;
  const label = [
    name,
    years,
    deceased && 'deceased',
    isMe && 'you',
    person.hiddenRelatives && 'more relatives not shown',
  ]
    .filter(Boolean)
    .join(', ');
  const cls = [
    'person-card',
    `person-card-${detail}`,
    deceased && 'is-deceased',
    isFocus && 'is-focus',
    isSelected && 'is-selected',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} onFocus={onFocus}>
      {detail === 'full' && (
        <span className="card-photo" aria-hidden="true">
          {initials(person)}
        </span>
      )}
      <button
        type="button"
        className="card-open nodrag"
        data-person-id={person.id}
        aria-label={label}
        onClick={onOpen}
      >
        {detail !== 'dot' && (
          <>
            <span className="card-name">{name}</span>
            {(years || deceased) && (
              <span className="card-years">
                {deceased && '† '}
                {years}
              </span>
            )}
            {isMe && <span className="card-you">You</span>}
          </>
        )}
      </button>
      {detail !== 'dot' && person.hiddenRelatives && (
        <span className="card-more" aria-hidden="true" title="More relatives not shown">
          …
        </span>
      )}
      {detail === 'full' &&
        person.canAddRelative &&
        ADD.map(({ as, where, word }) => {
          const noParents = as === 'sibling' && !person.hasParents;
          return (
            <button
              key={as}
              type="button"
              className={`card-add card-add-${where} nodrag`}
              aria-label={`Add a ${word} of ${name}`}
              title={noParents ? 'Add a parent first' : `Add a ${word}`}
              disabled={noParents}
              onClick={() => onAdd(as)}
            >
              +
            </button>
          );
        })}
    </div>
  );
}

const detailOf = (s: ReactFlowState) => cardDetail(s.transform[2]);

/** The React Flow node: hidden handles for the edges, plus the card. */
export function PersonNode({ data }: NodeProps<PersonFlowNode>) {
  const detail = useStore(detailOf);
  const actions = useCanvasActions();
  const id = data.person.id;
  const selected = useIsSelected(useSelectionStore(), id);
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} className="card-handle" />
      <PersonCardView
        person={data.person}
        detail={detail}
        isFocus={data.isFocus}
        isMe={data.isMe}
        isSelected={selected}
        onOpen={() => actions.openPerson(id)}
        onAdd={(as) => actions.addRelative(id, as)}
        onFocus={() => actions.reveal(id)}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="card-handle"
      />
    </>
  );
}
