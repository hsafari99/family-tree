import type { GraphPerson, RelativeRole } from '@family-tree/shared';
import { Handle, type NodeProps, Position, type ReactFlowState, useStore } from '@xyflow/react';
import { ChevronIcon } from '../components/icons';
import { PersonPhoto } from '../components/PersonPhoto';
import { initials, personName, personYears } from '../trees/format';
import { useRef } from 'react';
import type { MenuItem } from '../components/MenuList';
import { avatarTone } from './avatar-tone';
import { CardMenu, cardMenuItems, useCardMenu } from './CardMenu';
import { type CardDetail, cardDetail } from './canvas-settings';
import { useCanvasActions, useSelectionStore } from './CanvasActions';
import { useIsSelected } from './selection';
import { usePointerCoarse } from './use-pointer';
import type { PersonFlowNode, PersonNodeData } from './graph-to-flow';
import type { NavDirection } from './keyboard-nav';

const ARROWS: Record<string, NavDirection> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

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
  isCoarse = false,
  onOpen,
  onAdd,
  onFocus,
  menu,
  onNavigate,
  branch = null,
  onToggleBranch,
}: {
  person: GraphPerson;
  detail: CardDetail;
  isFocus: boolean;
  isMe: boolean;
  isSelected?: boolean;
  /** A touch screen: no hover, so the "+" buttons show on the selected card only. */
  isCoarse?: boolean;
  onOpen: () => void;
  onAdd: (as: RelativeRole) => void;
  onFocus?: () => void;
  /** The card's menu (right-click, long-press, Shift+F10); none without it. */
  menu?: MenuItem[];
  /** An arrow key on the card: move to a relative (Task 12). */
  onNavigate?: (dir: NavDirection) => void;
  /** Collapse state (Task 13): a chevron hides the descendants, "+N" shows them again. */
  branch?: PersonNodeData['branch'];
  onToggleBranch?: () => void;
}) {
  const openButton = useRef<HTMLButtonElement>(null);
  const cardMenu = useCardMenu(() => openButton.current);
  const pressed = useRef(false);
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
    <div
      className={cls}
      // Keyboard focus pans the card into view; a press doesn't, or the card would move out from
      // under the pointer before the click lands.
      onPointerDownCapture={() => void (pressed.current = true)}
      onPointerUpCapture={() => void (pressed.current = false)}
      onFocus={() => {
        if (!pressed.current) onFocus?.();
      }}
      {...(menu ? cardMenu.handlers : {})}
    >
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
        ref={openButton}
        className="card-open nodrag"
        data-person-id={person.id}
        aria-label={label}
        onClick={() => {
          if (!cardMenu.swallowClick()) onOpen();
        }}
        onKeyDown={(e) => {
          const dir = ARROWS[e.key];
          if (dir && onNavigate && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            e.preventDefault();
            onNavigate(dir);
          } else if (menu) cardMenu.onKeyDown(e);
        }}
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
        (!isCoarse || isSelected) &&
        ADD.map(({ as, where, word }) => (
          // A sibling of someone with no recorded parents shares a parents-unknown union (brief #11).
          <button
            key={as}
            type="button"
            className={`card-add card-add-${where} nodrag`}
            aria-label={`Add a ${word} of ${name}`}
            data-tip={`Add a ${word}`}
            onClick={() => onAdd(as)}
          >
            +
          </button>
        ))}
      {branch && onToggleBranch && detail !== 'dot' && branch.collapsed && (
        <button
          type="button"
          className="card-branch is-collapsed nodrag"
          aria-label={`Show ${branch.hidden} hidden descendants of ${name}`}
          data-tip="Show descendants"
          onClick={onToggleBranch}
        >
          +{branch.hidden}
        </button>
      )}
      {branch &&
        onToggleBranch &&
        detail === 'full' &&
        !branch.collapsed &&
        (!isCoarse || isSelected) && (
          <button
            type="button"
            className="card-branch nodrag"
            aria-label={`Hide descendants of ${name}`}
            data-tip="Hide descendants"
            onClick={onToggleBranch}
          >
            <ChevronIcon direction="up" />
          </button>
        )}
      {menu && cardMenu.at && (
        <CardMenu
          label={`Actions for ${name}`}
          items={menu}
          at={cardMenu.at}
          onClose={(refocus) => {
            cardMenu.close();
            if (refocus) openButton.current?.focus();
          }}
        />
      )}
    </div>
  );
}

const SIDE = { bottom: Position.Bottom, left: Position.Left, right: Position.Right } as const;

const detailOf = (s: ReactFlowState) => cardDetail(s.transform[2]);

/** The React Flow node: hidden handles for the edges, plus the card. */
export function PersonNode({ data }: NodeProps<PersonFlowNode>) {
  const detail = useStore(detailOf);
  const actions = useCanvasActions();
  const id = data.person.id;
  const selected = useIsSelected(useSelectionStore(), id);
  const coarse = usePointerCoarse();
  return (
    <>
      <Handle
        type="target"
        id="top"
        position={Position.Top}
        isConnectable={false}
        className="card-handle"
      />
      <PersonCardView
        person={data.person}
        detail={detail}
        isFocus={data.isFocus}
        isMe={data.isMe}
        isSelected={selected}
        isCoarse={coarse}
        onOpen={() => actions.openPerson(id)}
        onAdd={(as) => actions.addRelative(id, as)}
        onFocus={() => actions.reveal(id)}
        menu={cardMenuItems(data.person, actions)}
        onNavigate={(dir) => actions.move(id, dir)}
        branch={data.branch}
        onToggleBranch={() => actions.toggleBranch(id)}
      />
      {/* Bottom: children's and elbow partner lines; the sides: straight partner lines (Task 6). */}
      {(['bottom', 'left', 'right'] as const).map((id) => (
        <Handle
          key={id}
          type="source"
          id={id}
          position={SIDE[id]}
          isConnectable={false}
          className="card-handle"
        />
      ))}
    </>
  );
}
