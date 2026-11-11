const KEY = 'family-tree.panel-collapsed';

/** Whether the details panel was left collapsed (brief #15). Blocked storage reads as "open". */
export function readCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function writeCollapsed(v: boolean): void {
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    // Private mode or blocked storage: the choice just isn't remembered.
  }
}
