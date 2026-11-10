import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDownload } from './download';

afterEach(() => vi.restoreAllMocks());

describe('startDownload', () => {
  it('navigates to the URL through a temporary link, so the browser streams the file to disk', () => {
    const seen: { href: string; download: string; rel: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      seen.push({ href: this.href, download: this.getAttribute('download') ?? '', rel: this.rel });
    });
    const blob = vi.spyOn(URL, 'createObjectURL');
    startDownload('https://api.example.com/api/v1/trees/t1/export?ticket=abc');
    expect(seen).toEqual([
      {
        href: 'https://api.example.com/api/v1/trees/t1/export?ticket=abc',
        download: '',
        rel: 'noopener',
      },
    ]);
    expect(blob).not.toHaveBeenCalled(); // never holds the archive in memory
    expect(document.querySelector('a[hidden]')).toBeNull();
  });
});
