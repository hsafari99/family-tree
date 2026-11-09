import { type ReactNode, useState } from 'react';

/** A read-only link field with a Copy button, for links that are shown once. */
export function CopyLink({
  label,
  url,
  children,
}: {
  label: string;
  url: string;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="link-box">
      <p>{children}</p>
      <input
        readOnly
        aria-label={label}
        value={url}
        onFocus={(e) => e.currentTarget.select()}
      />{' '}
      <button type="button" onClick={() => void copy()}>
        Copy
      </button>
      {copied && (
        <span role="status" className="success">
          Copied
        </span>
      )}
    </div>
  );
}
