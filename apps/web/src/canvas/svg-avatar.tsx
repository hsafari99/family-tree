import type { GraphPerson } from '@family-tree/shared';
import { useId, useState } from 'react';
import { initials } from '../trees/format';
import { avatarTone } from './avatar-tone';

/** A round avatar inside an SVG (the fan and the tree): the photo, or initials on a tone. */
export function SvgAvatar({
  person,
  cx,
  cy,
  r,
}: {
  person: GraphPerson;
  cx: number;
  cy: number;
  r: number;
}) {
  const clip = useId();
  const [failed, setFailed] = useState<string | null>(null);
  const url = person.photoThumbUrl;
  if (url && failed !== url) {
    return (
      <g className="svg-avatar">
        <clipPath id={clip}>
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
        <circle className={`svg-av svg-av${avatarTone(person.id)}`} cx={cx} cy={cy} r={r} />
        <image
          href={url}
          x={cx - r}
          y={cy - r}
          width={2 * r}
          height={2 * r}
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${CSS.escape(clip)})`}
          onError={() => setFailed(url)}
        />
      </g>
    );
  }
  return (
    <g className="svg-avatar">
      <circle className={`svg-av svg-av${avatarTone(person.id)}`} cx={cx} cy={cy} r={r} />
      <text
        className="svg-av-ini"
        x={cx}
        y={cy}
        dy="0.35em"
        textAnchor="middle"
        style={{ fontSize: Math.round(r * 0.55) }}
      >
        {initials(person)}
      </text>
    </g>
  );
}

/** "Robert", or the full name when there is no first name. */
export const firstName = (p: GraphPerson) => p.givenName || p.surname || '?';

/** Cut to `max` characters with an ellipsis. */
export const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
