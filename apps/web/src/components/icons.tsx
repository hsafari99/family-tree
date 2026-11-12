import type { CSSProperties, ReactNode } from 'react';

/**
 * The app's one icon set: line icons on a 24 grid, 2px strokes, drawn in currentColor so they
 * follow the text's colour (hover, current, danger). Decorative: a text label or the button's
 * aria-label names each one.
 */
function Icon({
  children,
  style,
  data,
}: {
  children: ReactNode;
  style?: CSSProperties;
  /** A data-icon value, for tests that tell two states of one icon apart. */
  data?: string;
}) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={style}
      data-icon={data}
    >
      {children}
    </svg>
  );
}

export const UserIcon = () => (
  <Icon>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Icon>
);

export const UsersIcon = () => (
  <Icon>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.2a6.5 6.5 0 0 1 3.5 5.8" />
  </Icon>
);

export const KeyIcon = () => (
  <Icon>
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="M10.7 12.3 21 2M16 7l3 3M18.5 4.5l2 2" />
  </Icon>
);

export const ShieldIcon = () => (
  <Icon>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

export const LinkIcon = () => (
  <Icon>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </Icon>
);

/** How are we related: two people joined by a winding path. */
export const LinkPathIcon = () => (
  <Icon>
    <circle cx="5.5" cy="5.5" r="2.5" />
    <circle cx="18.5" cy="18.5" r="2.5" />
    <path d="M8 5.5h7.5a3.25 3.25 0 0 1 0 6.5h-7a3.25 3.25 0 0 0 0 6.5H16" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const EditIcon = () => (
  <Icon>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
  </Icon>
);

/** Settings: three sliders. */
export const SettingsIcon = () => (
  <Icon>
    <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
    <circle cx="15" cy="6" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="17" cy="18" r="2" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Icon>
);

export const ListIcon = () => (
  <Icon>
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </Icon>
);

export const ZoomInIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5M11 8v6M8 11h6" />
  </Icon>
);

export const ZoomOutIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5M8 11h6" />
  </Icon>
);

/** Fit the whole tree: four corners. */
export const FitIcon = () => (
  <Icon>
    <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
  </Icon>
);

/** Centre on me: a crosshair. */
export const TargetIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </Icon>
);

/** A person's details: an id card. */
export const IdCardIcon = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="11" r="2" />
    <path d="M5.5 16a3.5 3.5 0 0 1 7 0M15 10h3M15 14h3" />
  </Icon>
);

/** Places: a map pin. */
export const MapPinIcon = () => (
  <Icon>
    <path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Icon>
);

/** Photos: a framed picture. */
export const ImageIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="m21 16-5-5-8 9" />
  </Icon>
);

/** History: a clock. */
export const ClockIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);

/** The minimap: a folded map. */
export const MapIcon = () => (
  <Icon>
    <path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z" />
    <path d="M9 4v13.5M15 6.5V20" />
  </Icon>
);

export const ChevronDownIcon = () => (
  <Icon>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const ChevronRightIcon = () => (
  <Icon>
    <path d="m9 6 6 6-6 6" />
  </Icon>
);

const CHEVRON_TURN = { right: undefined, up: 'rotate(-90deg)', left: 'rotate(180deg)' } as const;

/** A chevron pointing right (opens here), or turned up or left. */
export const ChevronIcon = ({ direction = 'right' }: { direction?: 'right' | 'up' | 'left' }) => (
  <Icon style={CHEVRON_TURN[direction] ? { transform: CHEVRON_TURN[direction] } : undefined}>
    <path d="m9 6 6 6-6 6" />
  </Icon>
);

/** "Goes to another page" (or, pointing down, further down this one). */
export const ArrowIcon = ({ direction = 'right' }: { direction?: 'right' | 'down' }) => (
  <Icon style={direction === 'down' ? { transform: 'rotate(90deg)' } : undefined}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const ArrowLeftIcon = () => (
  <Icon>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </Icon>
);

export const XIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

/** The ⋯ of a "more actions" menu. */
export const MoreIcon = () => (
  <Icon>
    <circle cx="5" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="19" cy="12" r="1" fill="currentColor" />
  </Icon>
);

/** The Focus view: a centre dot in a ring. */
export const FocusIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3" fill="currentColor" />
  </Icon>
);

/** The Full view: a small chart of boxes. */
export const FullIcon = () => (
  <Icon>
    <rect x="9" y="2.5" width="6" height="5" rx="1" />
    <rect x="2.5" y="16.5" width="6" height="5" rx="1" />
    <rect x="15.5" y="16.5" width="6" height="5" rx="1" />
    <path d="M12 7.5V12M5.5 16.5V12h13v4.5" />
  </Icon>
);

/** The Fan chart: a half disc in rings and spokes. */
export const FanIcon = () => (
  <Icon>
    <path d="M3 18a9 9 0 0 1 18 0z" />
    <path d="M8 18a4 4 0 0 1 8 0M12 9v5M5.6 11.6l3.6 3.6M18.4 11.6l-3.6 3.6" />
  </Icon>
);

/** The Illustrated tree: a canopy on a trunk. */
export const TreeIcon = () => (
  <Icon>
    <path d="M12 3a5 5 0 0 0-4.8 6.4A4 4 0 0 0 8 17h8a4 4 0 0 0 .8-7.6A5 5 0 0 0 12 3z" />
    <path d="M12 21v-8M12 15l2.5-2" />
  </Icon>
);

export const CheckCircleIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 3 3 5-6" />
  </Icon>
);

export const CrossCircleIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="m9 9 6 6M15 9l-6 6" />
  </Icon>
);

export const UploadIcon = () => (
  <Icon>
    <path d="M12 15V3M7 8l5-5 5 5" />
    <path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
  </Icon>
);

/** An eye, crossed out while the password shows. */
export const EyeIcon = ({ crossed = false }: { crossed?: boolean }) => (
  <Icon data={crossed ? 'eye-off' : 'eye'}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
    {crossed && <path d="M3 3l18 18" />}
  </Icon>
);
