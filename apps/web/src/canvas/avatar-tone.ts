export type AvatarTone = 1 | 2 | 3 | 4 | 5 | 6;

/** One of the six `--avN` tones, from a stable hash (FNV-1a) of the id: same person, same colour. */
export function avatarTone(id: string): AvatarTone {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (((h >>> 0) % 6) + 1) as AvatarTone;
}
