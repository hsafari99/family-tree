import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { initials } from '../trees/format';

/** Asked for when a photo fails to load, usually an expired signed URL (decision 22). */
export const PhotoRefreshContext = createContext<() => void>(() => {});

/** A refresh that runs at most once per `ms`. */
export function useThrottled(fn: () => void, ms = 60_000): () => void {
  const last = useRef(0);
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback(() => {
    const now = Date.now();
    if (now - last.current < ms) return;
    last.current = now;
    latest.current();
  }, [ms]);
}

/**
 * A person's photo, or their initials when there is none or it fails to load. `alt` is empty by
 * default: the name is already in the surrounding label.
 */
export function PersonPhoto({
  url,
  person,
  className,
  alt = '',
  tone,
}: {
  url: string | null;
  person: Parameters<typeof initials>[0];
  className: string;
  alt?: string;
  /** The `--avN` background for the initials (see avatarTone). */
  tone?: number;
}) {
  const refresh = useContext(PhotoRefreshContext);
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) {
    const cls = tone ? `${className} tone-${tone}` : className;
    return alt ? (
      <span className={cls} role="img" aria-label={alt}>
        {initials(person)}
      </span>
    ) : (
      <span className={cls} aria-hidden="true">
        {initials(person)}
      </span>
    );
  }
  return (
    <img
      className={className}
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => {
        setFailed(url);
        refresh();
      }}
    />
  );
}
