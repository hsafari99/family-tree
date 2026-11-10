/**
 * Starts a download by navigating to `url` through a temporary link (review fix I1). The API
 * answers with `Content-Disposition: attachment`, so the page stays put and the browser streams
 * the file to disk; nothing is read into memory here (an archive can reach 3.5 GB). The session
 * cookie goes along because this is a top-level GET (SameSite=Lax allows that).
 */
export function startDownload(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
}
