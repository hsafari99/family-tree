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
  const [copied, setCopied] = useState<boolean | null>(null);
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
      {/* The field and its button on one row; the result as a line of text under them. */}
      <div className="link-box-row">
        <input readOnly aria-label={label} value={url} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" onClick={() => void copy()}>
          Copy
        </button>
      </div>
      <p role="status" className={copied === false ? 'link-box-status' : 'link-box-status is-ok'}>
        {copied === true && 'Copied'}
        {copied === false && 'Couldn’t copy — select the link and copy it'}
      </p>
    </div>
  );
}
