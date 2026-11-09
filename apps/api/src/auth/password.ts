import { hash, verify } from '@node-rs/argon2';

// OWASP 2024 minimum for argon2id: m=19 MiB, t=2, p=1 (~60 ms on the dev CPU).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword({
  hash: stored,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}
