import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileNameFrom, saveFile } from './download';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('fileNameFrom', () => {
  it('reads a plain quoted file name', () => {
    expect(fileNameFrom('attachment; filename="family-tree-2026-11-10.zip"')).toBe(
      'family-tree-2026-11-10.zip',
    );
  });

  it('falls back for a missing or unusual name', () => {
    expect(fileNameFrom(null)).toBe('family-tree-export.zip');
    expect(fileNameFrom('attachment; filename="../../x y.zip"')).toBe('family-tree-export.zip');
  });
});

describe('saveFile', () => {
  it('clicks a temporary download link and revokes the URL a minute later', () => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const seen: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      seen.push({ href: this.href, download: this.download });
    });
    saveFile(new Blob(['PK']), 't.zip');
    expect(create).toHaveBeenCalledOnce();
    expect(seen).toEqual([{ href: 'blob:export', download: 't.zip' }]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith('blob:export');
  });
});
