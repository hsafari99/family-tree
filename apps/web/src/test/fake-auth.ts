import type { AuthApi, AuthError, Result, SessionUser } from '../auth/api';
import { MESSAGES, SESSION_EXPIRED } from '../auth/api';

/** The only TOTP code the fake accepts. */
export const FAKE_TOTP = '123456';
export const FAKE_TOTP_URI =
  'otpauth://totp/Family%20Tree:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Family%20Tree';
export const FAKE_SECRET = 'JBSWY3DPEHPK3PXP';
/** Moving 2FA: the new phone's key, and the only code the fake accepts from it. */
export const FAKE_NEW_SECRET = 'KRUGS4ZANFZSA3TF';
export const FAKE_NEW_TOTP = '654321';
export const FAKE_NEW_TOTP_URI = `otpauth://totp/Family%20Tree:ada%40example.com?secret=${FAKE_NEW_SECRET}&issuer=Family%20Tree`;

interface FakeUser {
  id: string;
  name: string;
  email: string;
  password: string;
  twoFactorEnabled: boolean;
  requiresTwoFactor: boolean;
  twoFactorPending: boolean;
  recoveryCodes: string[];
  /** A started move to a new phone, waiting for its code. */
  movePending?: boolean;
  /** Set to make deleteAccount fail with OWNS_TREES. */
  ownsTrees?: boolean;
  /** False for an account that only ever signed in with Google. */
  hasPassword: boolean;
  googleConnected: boolean;
}

type Method = keyof AuthApi;

let codeBatch = 0;
function newRecoveryCodes(): string[] {
  codeBatch += 1;
  return Array.from({ length: 8 }, (_, i) => `code${codeBatch}-${String(i).padStart(5, '0')}`);
}

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (code: string, message: string): Result<never> => ({
  ok: false,
  error: { code, message },
});

/** An in-memory AuthApi. Tests can seed users, force errors and inspect calls. */
export class FakeAuthApi implements AuthApi {
  users = new Map<string, FakeUser>();
  current: string | null = null;
  /** Email that passed the password step and still needs a second factor. */
  challenge: string | null = null;
  resetTokens = new Map<string, string>();
  calls: { method: Method; input: unknown }[] = [];
  /** What getProviders answers. */
  providers = { google: true };
  /** False makes setPassword answer RECENT_SIGN_IN_REQUIRED, as for a session over 10 minutes old. */
  recentSignIn = true;
  /** True makes confirmTwoFactorMove answer MOVE_EXPIRED, as after 10 minutes. */
  moveExpired = false;
  private forced = new Map<Method, AuthError>();
  private pending = new Set<Method>();
  private waiting: (() => void)[] = [];

  addUser(
    input: Partial<Omit<FakeUser, 'id'>> & { email: string },
    { signedIn = false } = {},
  ): FakeUser {
    const user: FakeUser = {
      id: crypto.randomUUID(),
      name: 'Ada Lovelace',
      password: 'correct-horse',
      twoFactorEnabled: false,
      requiresTwoFactor: false,
      twoFactorPending: false,
      recoveryCodes: [],
      hasPassword: true,
      googleConnected: false,
      ...input,
    };
    if (user.twoFactorEnabled && user.recoveryCodes.length === 0) {
      user.recoveryCodes = newRecoveryCodes();
    }
    this.users.set(user.email, user);
    if (signedIn) this.current = user.email;
    return user;
  }

  /** The next call to `method` fails with this error. */
  failNext(method: Method, error: AuthError) {
    this.forced.set(method, error);
  }

  /** Calls to `method` wait until `release()` is called. */
  hold(method: Method) {
    this.pending.add(method);
  }

  release() {
    this.pending.clear();
    for (const resolve of this.waiting.splice(0)) resolve();
  }

  callsTo(method: Method) {
    return this.calls.filter((c) => c.method === method).map((c) => c.input);
  }

  private async enter(method: Method, input?: unknown): Promise<AuthError | null> {
    this.calls.push({ method, input });
    if (this.pending.has(method)) await new Promise<void>((r) => this.waiting.push(r));
    const forced = this.forced.get(method);
    if (forced) {
      this.forced.delete(method);
      return forced;
    }
    return null;
  }

  private me(): FakeUser | undefined {
    return this.current ? this.users.get(this.current) : undefined;
  }

  private toSession(u: FakeUser): SessionUser {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      twoFactorEnabled: u.twoFactorEnabled,
      requiresTwoFactor: u.requiresTwoFactor,
      hasPassword: u.hasPassword,
      googleConnected: u.googleConnected,
    };
  }

  async getMe() {
    const forced = await this.enter('getMe');
    if (forced) return { ok: false as const, error: forced };
    const u = this.me();
    return ok(u ? this.toSession(u) : null);
  }

  async signUp(input: { name: string; email: string; password: string }) {
    const forced = await this.enter('signUp', input);
    if (forced) return { ok: false as const, error: forced };
    if (this.users.has(input.email)) return fail('USER_ALREADY_EXISTS', MESSAGES.emailTaken);
    this.addUser(input, { signedIn: true });
    return ok(undefined);
  }

  async signIn(input: { email: string; password: string }) {
    const forced = await this.enter('signIn', input);
    if (forced) return { ok: false as const, error: forced };
    const u = this.users.get(input.email);
    if (!u || u.password !== input.password) {
      return fail('INVALID_EMAIL_OR_PASSWORD', MESSAGES.badCredentials);
    }
    if (u.twoFactorEnabled) {
      this.challenge = u.email;
      return ok({ twoFactorRequired: true });
    }
    this.current = u.email;
    return ok({ twoFactorRequired: false });
  }

  async verifyTotp(input: { code: string; trustDevice: false }) {
    const forced = await this.enter('verifyTotp', input);
    if (forced) return { ok: false as const, error: forced };
    if (!this.challenge) return fail('INVALID_TWO_FACTOR_COOKIE', MESSAGES.challengeExpired);
    if (input.code !== FAKE_TOTP) return fail('INVALID_CODE', MESSAGES.badCode);
    this.current = this.challenge;
    this.challenge = null;
    return ok(undefined);
  }

  async verifyRecoveryCode(input: { code: string }) {
    const forced = await this.enter('verifyRecoveryCode', input);
    if (forced) return { ok: false as const, error: forced };
    const u = this.challenge ? this.users.get(this.challenge) : undefined;
    if (!u) return fail('INVALID_TWO_FACTOR_COOKIE', MESSAGES.challengeExpired);
    if (!u.recoveryCodes.includes(input.code)) {
      return fail('INVALID_BACKUP_CODE', MESSAGES.badRecoveryCode);
    }
    u.recoveryCodes = u.recoveryCodes.filter((c) => c !== input.code);
    this.current = u.email;
    this.challenge = null;
    return ok(undefined);
  }

  async signOut() {
    const forced = await this.enter('signOut');
    if (forced) return { ok: false as const, error: forced };
    this.current = null;
    return ok(undefined);
  }

  private checkPassword(password: string): Result<FakeUser> {
    const u = this.me();
    if (!u) return fail('UNAUTHORIZED', MESSAGES.badCredentials);
    if (u.password !== password) return fail('INVALID_PASSWORD', MESSAGES.badPassword);
    return ok(u);
  }

  async startTwoFactorSetup(input: { password: string }) {
    const forced = await this.enter('startTwoFactorSetup', input);
    if (forced) return { ok: false as const, error: forced };
    const checked = this.checkPassword(input.password);
    if (!checked.ok) return checked;
    checked.data.twoFactorPending = true;
    checked.data.recoveryCodes = newRecoveryCodes();
    return ok({ totpURI: FAKE_TOTP_URI, backupCodes: [...checked.data.recoveryCodes] });
  }

  async confirmTwoFactorSetup(input: { code: string }) {
    const forced = await this.enter('confirmTwoFactorSetup', input);
    if (forced) return { ok: false as const, error: forced };
    const u = this.me();
    if (!u?.twoFactorPending) return fail('TOTP_NOT_ENABLED', 'TOTP not enabled');
    if (input.code !== FAKE_TOTP) return fail('INVALID_CODE', MESSAGES.badCode);
    u.twoFactorPending = false;
    u.twoFactorEnabled = true;
    return ok(undefined);
  }

  async regenerateRecoveryCodes(input: { password: string }) {
    const forced = await this.enter('regenerateRecoveryCodes', input);
    if (forced) return { ok: false as const, error: forced };
    const checked = this.checkPassword(input.password);
    if (!checked.ok) return checked;
    checked.data.recoveryCodes = newRecoveryCodes();
    return ok([...checked.data.recoveryCodes]);
  }

  async disableTwoFactor(input: { password: string }) {
    const forced = await this.enter('disableTwoFactor', input);
    if (forced) return { ok: false as const, error: forced };
    const checked = this.checkPassword(input.password);
    if (!checked.ok) return checked;
    checked.data.twoFactorEnabled = false;
    checked.data.recoveryCodes = [];
    return ok(undefined);
  }

  async changePassword(input: { currentPassword: string; newPassword: string }) {
    const forced = await this.enter('changePassword', input);
    if (forced) return { ok: false as const, error: forced };
    const checked = this.checkPassword(input.currentPassword);
    if (!checked.ok) return checked;
    checked.data.password = input.newPassword;
    return ok(undefined);
  }

  async resetWithCode(input: { email: string; code: string; newPassword: string }) {
    const forced = await this.enter('resetWithCode', input);
    if (forced) return { ok: false as const, error: forced };
    const u = this.users.get(input.email);
    const valid =
      u?.twoFactorEnabled && (input.code === FAKE_TOTP || u.recoveryCodes.includes(input.code));
    if (!u || !valid) return fail('INVALID_RESET', 'Email or code is incorrect');
    u.recoveryCodes = u.recoveryCodes.filter((c) => c !== input.code);
    u.password = input.newPassword;
    return ok(undefined);
  }

  async resetWithLink(input: { token: string; newPassword: string }) {
    const forced = await this.enter('resetWithLink', input);
    if (forced) return { ok: false as const, error: forced };
    const email = this.resetTokens.get(input.token);
    const u = email ? this.users.get(email) : undefined;
    if (!u) return fail('INVALID_RESET', 'Email or code is incorrect');
    this.resetTokens.delete(input.token);
    u.password = input.newPassword;
    return ok(undefined);
  }

  async deleteAccount(input: { password: string }) {
    const forced = await this.enter('deleteAccount', input);
    if (forced) return { ok: false as const, error: forced };
    const checked = this.checkPassword(input.password);
    if (!checked.ok) return checked;
    if (checked.data.ownsTrees) return fail('OWNS_TREES', MESSAGES.ownsTrees);
    this.users.delete(checked.data.email);
    this.current = null;
    return ok(undefined);
  }

  async getProviders() {
    const forced = await this.enter('getProviders');
    if (forced) return { ok: false as const, error: forced };
    return ok({ ...this.providers });
  }

  /** The real one leaves the page for Google; the fake only records the call. */
  async startGoogleSignIn(input: { next: string }) {
    const forced = await this.enter('startGoogleSignIn', input);
    if (forced) return { ok: false as const, error: forced };
    return ok(undefined);
  }

  async connectGoogle(input: { password: string; code?: string }) {
    const forced = await this.enter('connectGoogle', input);
    if (forced) return { ok: false as const, error: forced };
    const checked = this.checkPassword(input.password);
    if (!checked.ok) return checked;
    if (checked.data.twoFactorEnabled) {
      if (!input.code) return fail('TWO_FACTOR_CODE_REQUIRED', MESSAGES.codeRequired);
      if (input.code !== FAKE_TOTP) return fail('INVALID_CODE', MESSAGES.badCode);
    }
    return ok(undefined);
  }

  async disconnectGoogle(input: { password: string; code?: string }) {
    const forced = await this.enter('disconnectGoogle', input);
    if (forced) return { ok: false as const, error: forced };
    const u = this.me();
    if (!u) return fail(SESSION_EXPIRED, MESSAGES.sessionExpired);
    if (!u.googleConnected) return fail('GOOGLE_NOT_CONNECTED', MESSAGES.googleNotConnected);
    if (!u.hasPassword) {
      return fail('PASSWORD_REQUIRED_TO_DISCONNECT', MESSAGES.passwordRequiredToDisconnect);
    }
    const checked = this.checkPassword(input.password);
    if (!checked.ok) return checked;
    if (u.twoFactorEnabled) {
      if (!input.code) return fail('TWO_FACTOR_CODE_REQUIRED', MESSAGES.codeRequired);
      if (input.code !== FAKE_TOTP) return fail('INVALID_CODE', MESSAGES.badCode);
    }
    u.googleConnected = false;
    return ok(undefined);
  }

  async setPassword(input: { newPassword: string }) {
    const forced = await this.enter('setPassword', input);
    if (forced) return { ok: false as const, error: forced };
    const u = this.me();
    if (!u) return fail(SESSION_EXPIRED, MESSAGES.sessionExpired);
    if (u.hasPassword) return fail('PASSWORD_ALREADY_SET', MESSAGES.passwordAlreadySet);
    if (!this.recentSignIn) {
      return fail('RECENT_SIGN_IN_REQUIRED', MESSAGES.recentSignInRequired);
    }
    u.password = input.newPassword;
    u.hasPassword = true;
    return ok(undefined);
  }

  async startTwoFactorMove(input: { password?: string; code: string }) {
    const forced = await this.enter('startTwoFactorMove', input);
    if (forced) return { ok: false as const, error: forced };
    const u = this.me();
    if (!u) return fail(SESSION_EXPIRED, MESSAGES.sessionExpired);
    if (!u.twoFactorEnabled) return fail('TWO_FACTOR_NOT_ENABLED', MESSAGES.twoFactorNotEnabled);
    if (u.hasPassword) {
      if (!input.password) return fail('PASSWORD_REQUIRED', MESSAGES.passwordRequired);
      if (input.password !== u.password) return fail('INVALID_PASSWORD', MESSAGES.badPassword);
    } else if (!this.recentSignIn) {
      return fail('RECENT_SIGN_IN_REQUIRED', MESSAGES.recentSignInRequired);
    }
    if (!input.code) return fail('TWO_FACTOR_CODE_REQUIRED', MESSAGES.codeRequired);
    if (input.code !== FAKE_TOTP && !u.recoveryCodes.includes(input.code)) {
      return fail('INVALID_CODE', MESSAGES.badCode);
    }
    u.recoveryCodes = u.recoveryCodes.filter((c) => c !== input.code);
    u.movePending = true;
    return ok({ totpURI: FAKE_NEW_TOTP_URI });
  }

  async confirmTwoFactorMove(input: { code: string }) {
    const forced = await this.enter('confirmTwoFactorMove', input);
    if (forced) return { ok: false as const, error: forced };
    const u = this.me();
    if (!u) return fail(SESSION_EXPIRED, MESSAGES.sessionExpired);
    if (!u.movePending) return fail('MOVE_NOT_STARTED', MESSAGES.moveNotStarted);
    if (this.moveExpired) {
      u.movePending = false;
      return fail('MOVE_EXPIRED', MESSAGES.moveExpired);
    }
    if (input.code !== FAKE_NEW_TOTP) return fail('INVALID_CODE', MESSAGES.badCode);
    u.movePending = false;
    u.recoveryCodes = newRecoveryCodes();
    return ok({ backupCodes: [...u.recoveryCodes] });
  }

  async cancelTwoFactorMove() {
    const forced = await this.enter('cancelTwoFactorMove');
    if (forced) return { ok: false as const, error: forced };
    const u = this.me();
    if (u) u.movePending = false;
    return ok(undefined);
  }
}
