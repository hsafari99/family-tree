import type { GraphPerson, RelativeRole } from '@family-tree/shared';
import { Handle, type NodeProps, Position, type ReactFlowState, useStore } from '@xyflow/react';
import { PersonPhoto } from '../components/PersonPhoto';
import { initials, personName, personYears } from '../trees/format';
import { avatarTone } from './avatar-tone';
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
  const tone = avatarTone(person.id);
  const yearsLine = (years || deceased) && (
    <span className="card-years">
      {deceased && (
        <span className="card-dagger" aria-hidden="true">
          †{' '}
        </span>
      )}
      {years}
    </span>
  );
  return (
    <div className={cls} onFocus={onFocus}>
      {detail === 'full' ? (
        <PersonPhoto
          url={person.photoThumbUrl}
          person={person}
          className="card-avatar"
          tone={tone}
        />
      ) : (
        // Compact and dot cards load no image (many cards at a low zoom); dot has no text at all.
        <span className={`card-avatar tone-${tone}`} aria-hidden="true">
          {detail === 'compact' && initials(person)}
        </span>
      )}
      <button
        type="button"
        className="card-open nodrag"
        data-person-id={person.id}
        aria-label={label}
        onClick={onOpen}
      >
        {detail === 'full' && (
          <>
            <span className="card-name" title={name}>
              {name}
            </span>
            {yearsLine}
          </>
        )}
        {detail === 'compact' && (
          <span className="card-name" title={name}>
            {person.givenName || name}
          </span>
        )}
      </button>
      {detail === 'full' && isMe && <span className="card-you">You</span>}
      {detail !== 'dot' && person.hiddenRelatives && (
        <span className="card-more" aria-hidden="true" title="More relatives not shown">
          …
        </span>
      )}
      {detail === 'full' &&
        person.canAddRelative &&
        ADD.map(({ as, where, word }) => (
          // A sibling of someone with no recorded parents shares a parents-unknown union (brief #11).
          <button
            key={as}
            type="button"
            className={`card-add card-add-${where} nodrag`}
            aria-label={`Add a ${word} of ${name}`}
            title={`Add a ${word}`}
            onClick={() => onAdd(as)}
          >
            +
          </button>
        ))}
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
