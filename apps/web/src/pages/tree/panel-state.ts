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

const whoamiKey = (treeId: string) => `family-tree.whoami-dismissed.${treeId}`;

/** Whether "Which one is you?" was dismissed on this tree. Blocked storage reads as "not yet". */
export function readWhoamiDismissed(treeId: string): boolean {
  try {
    return localStorage.getItem(whoamiKey(treeId)) === '1';
  } catch {
    return false;
  }
}

export function writeWhoamiDismissed(treeId: string): void {
  try {
    localStorage.setItem(whoamiKey(treeId), '1');
  } catch {
    // Blocked storage: it shows again next time, which is harmless.
  }
}
