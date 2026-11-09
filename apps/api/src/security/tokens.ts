import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes, URL-safe. Only hashToken(token) is ever stored (spec §8). */
export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
