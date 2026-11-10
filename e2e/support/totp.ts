import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';

/** The raw secret from the base32 text the app shows (or a totpURI's `secret`). */
export const rawSecret = (b32: string) => new TextDecoder().decode(base32.decode(b32));
export const totpCode = (raw: string) => createOTP(raw).totp();
