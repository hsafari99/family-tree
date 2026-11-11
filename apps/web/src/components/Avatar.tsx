import { useState } from 'react';

/** "Ada Lovelace" → "AL"; one word → its first letter; nothing → "?". */
export function nameInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = (w: string) => [...w][0] ?? '';
  const last = words.length > 1 ? first(words[words.length - 1]!) : '';
  return (first(words[0]!) + last).toLocaleUpperCase();
}

/**
 * A user's profile picture, round, `size` pixels across. Without one (or when it fails to load,
 * e.g. an expired signed URL) it shows their initials on a token-coloured circle. The name is
 * the alternative text either way.
 */
export function Avatar({
  name,
  url,
  size = 40,
  className,
}: {
  name: string;
  url: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)) };
  const classes = className ? `avatar ${className}` : 'avatar';
  if (!url || failed === url) {
    return (
      <span className={`${classes} avatar-default`} style={style} role="img" aria-label={name}>
        <span aria-hidden="true">{nameInitials(name)}</span>
      </span>
    );
  }
  return (
    <img
      className={classes}
      style={style}
      src={url}
      alt={name}
      width={size}
      height={size}
      decoding="async"
      onError={() => setFailed(url)}
    />
  );
}
