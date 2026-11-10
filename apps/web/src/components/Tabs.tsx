import type { KeyboardEvent } from 'react';

export interface TabDef {
  id: string;
  label: string;
}

/** A tab list; the page renders the active `<div role="tabpanel" id="panel-{id}" aria-labelledby="tab-{id}">`. */
export function Tabs({
  tabs,
  current,
  onChange,
}: {
  tabs: readonly TabDef[];
  current: string;
  onChange: (id: string) => void;
}) {
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length]!;
    onChange(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }
  return (
    <div role="tablist" className="tabs">
      {tabs.map((tab, i) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={tab.id === current}
          aria-controls={`panel-${tab.id}`}
          tabIndex={tab.id === current ? 0 : -1}
          className="secondary"
          onClick={() => onChange(tab.id)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
