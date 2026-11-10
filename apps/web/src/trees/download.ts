/** The file name from `Content-Disposition: attachment; filename="…"`, or a safe default. */
export function fileNameFrom(header: string | null): string {
  const match = header?.match(/filename="([A-Za-z0-9._-]+)"/);
  return match?.[1] ?? 'family-tree-export.zip';
}

/** Saves a blob through a temporary object URL and a download link (decision 9). */
export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  // The download has started by then; keeping the URL longer would hold the blob in memory.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
