import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const devEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://family:dev-only-pw@localhost:5432/family',
  WEB_ORIGIN: 'http://localhost:5173',
  AUTH_BASE_URL: 'http://localhost:5173',
  SESSION_SECRET: 'dev-only-session-secret-change-me-0000000000',
  S3_ENDPOINT: 'http://localhost:8333',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'family-photos',
  S3_ACCESS_KEY_ID: 'dev-only-access-key',
  S3_SECRET_ACCESS_KEY: 'dev-only-secret-key',
  S3_FORCE_PATH_STYLE: 'true',
  S3_CREATE_BUCKET: 'true',
};

const prodEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://family:Str0ngPassw0rd@postgres:5432/family',
  WEB_ORIGIN: 'https://family.cortextechservices.com',
  AUTH_BASE_URL: 'https://api.family.cortextechservices.com',
  SESSION_SECRET: 'test-only-prod-like-session-secret-0123456789abcdef',
  S3_ENDPOINT: 'https://0123456789abcdef.r2.cloudflarestorage.com',
  S3_REGION: 'auto',
  S3_BUCKET: 'family-photos',
  S3_ACCESS_KEY_ID: 'AKIAREALKEY',
  S3_SECRET_ACCESS_KEY: 'realsecretvalue',
};

describe('loadConfig', () => {
  it('parses a valid development env and applies defaults and coercion', () => {
    const config = loadConfig({ ...devEnv, PORT: '4000' });
    expect(config.PORT).toBe(4000);
    expect(config.HOST).toBe('0.0.0.0');
    expect(config.S3_FORCE_PATH_STYLE).toBe(true);
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('names the missing variable in the error', () => {
    const env: Record<string, string | undefined> = { ...devEnv };
    delete env.DATABASE_URL;
    expect(() => loadConfig(env)).toThrowError(ConfigError);
    expect(() => loadConfig(env)).toThrowError(/DATABASE_URL/);
  });

  it('rejects a short session secret', () => {
    expect(() => loadConfig({ ...devEnv, SESSION_SECRET: 'short' })).toThrowError(/SESSION_SECRET/);
  });

  it('accepts a valid production env', () => {
    expect(loadConfig(prodEnv).NODE_ENV).toBe('production');
  });

  it('rejects dev-only values in production', () => {
    expect(() =>
      loadConfig({ ...prodEnv, SESSION_SECRET: 'dev-only-session-secret-change-me-0000000000' }),
    ).toThrowError(/SESSION_SECRET/);
  });

  it('rejects http and localhost endpoints in production', () => {
    expect(() => loadConfig({ ...prodEnv, S3_ENDPOINT: 'http://localhost:8333' })).toThrowError(
      /S3_ENDPOINT/,
    );
    expect(() => loadConfig({ ...prodEnv, WEB_ORIGIN: 'http://family.example.com' })).toThrowError(
      /WEB_ORIGIN/,
    );
  });

  it('rejects a WEB_ORIGIN with a trailing slash or path', () => {
    expect(() => loadConfig({ ...devEnv, WEB_ORIGIN: 'http://localhost:5173/' })).toThrowError(
      /WEB_ORIGIN/,
    );
    expect(() => loadConfig({ ...devEnv, WEB_ORIGIN: 'http://localhost:5173/app' })).toThrowError(
      /WEB_ORIGIN/,
    );
  });

  it('rejects an out-of-range PORT', () => {
    expect(() => loadConfig({ ...devEnv, PORT: '99999' })).toThrowError(/PORT/);
  });

  it('rejects dev and placeholder markers in any variable, case-insensitively', () => {
    expect(() =>
      loadConfig({
        ...prodEnv,
        DATABASE_URL: 'postgres://family:dev-only-pw@postgres:5432/family',
      }),
    ).toThrowError(/DATABASE_URL/);
    expect(() =>
      loadConfig({ ...prodEnv, DATABASE_URL: 'postgres://family:CHANGE_ME@postgres:5432/family' }),
    ).toThrowError(/DATABASE_URL/);
    expect(() => loadConfig({ ...prodEnv, S3_ACCESS_KEY_ID: 'DEV-ONLY-KEY' })).toThrowError(
      /S3_ACCESS_KEY_ID/,
    );
  });

  it.each([
    'https://localhost',
    'https://localhost.',
    'https://127.0.0.2',
    'https://host.docker.internal',
  ])('rejects local S3 endpoint %s in production', (endpoint) => {
    expect(() => loadConfig({ ...prodEnv, S3_ENDPOINT: endpoint })).toThrowError(/S3_ENDPOINT/);
  });

  it('reports empty URLs as config errors instead of crashing', () => {
    expect(() => loadConfig({ ...prodEnv, S3_ENDPOINT: '' })).toThrowError(ConfigError);
    expect(() => loadConfig({ ...prodEnv, S3_ENDPOINT: '' })).toThrowError(/S3_ENDPOINT/);
  });

  it('rejects automatic bucket creation in production', () => {
    expect(() => loadConfig({ ...prodEnv, S3_CREATE_BUCKET: 'true' })).toThrowError(
      /S3_CREATE_BUCKET/,
    );
  });

  it('uses path-style S3 URLs in production and refuses virtual-hosted ones', () => {
    // R2's virtual-hosted host (<bucket>.<account>.r2...) is not in the web app's CSP img-src.
    expect(loadConfig(prodEnv).S3_FORCE_PATH_STYLE).toBe(true);
    expect(loadConfig({ ...prodEnv, S3_FORCE_PATH_STYLE: 'true' }).S3_FORCE_PATH_STYLE).toBe(true);
    expect(() => loadConfig({ ...prodEnv, S3_FORCE_PATH_STYLE: 'false' })).toThrowError(
      /S3_FORCE_PATH_STYLE/,
    );
    expect(loadConfig(devEnv).S3_FORCE_PATH_STYLE).toBe(true);
    const env: Record<string, string | undefined> = { ...devEnv };
    delete env.S3_FORCE_PATH_STYLE;
    expect(loadConfig(env).S3_FORCE_PATH_STYLE).toBe(false);
  });

  it('requires AUTH_BASE_URL', () => {
    const env: Record<string, string | undefined> = { ...devEnv };
    delete env.AUTH_BASE_URL;
    expect(() => loadConfig(env)).toThrowError(/AUTH_BASE_URL/);
  });

  it('rejects an AUTH_BASE_URL that is not a bare origin', () => {
    expect(() => loadConfig({ ...devEnv, AUTH_BASE_URL: 'http://localhost:5173/' })).toThrowError(
      /AUTH_BASE_URL/,
    );
    expect(() =>
      loadConfig({ ...devEnv, AUTH_BASE_URL: 'http://localhost:5173/api/auth' }),
    ).toThrowError(/AUTH_BASE_URL/);
  });

  it('rejects an http or local AUTH_BASE_URL in production', () => {
    expect(() =>
      loadConfig({ ...prodEnv, AUTH_BASE_URL: 'http://api.family.example.com' }),
    ).toThrowError(/AUTH_BASE_URL/);
    expect(() => loadConfig({ ...prodEnv, AUTH_BASE_URL: 'https://localhost' })).toThrowError(
      /AUTH_BASE_URL/,
    );
  });

  it('parses TREE_PURGE_INTERVAL_MINUTES, defaulting to 60', () => {
    expect(loadConfig(devEnv).TREE_PURGE_INTERVAL_MINUTES).toBe(60);
    expect(
      loadConfig({ ...devEnv, TREE_PURGE_INTERVAL_MINUTES: '0' }).TREE_PURGE_INTERVAL_MINUTES,
    ).toBe(0);
    for (const bad of ['-1', 'abc']) {
      expect(() => loadConfig({ ...devEnv, TREE_PURGE_INTERVAL_MINUTES: bad })).toThrowError(
        /TREE_PURGE_INTERVAL_MINUTES/,
      );
    }
  });

  it('parses MAX_TREES_PER_USER, defaulting to 3', () => {
    expect(loadConfig(devEnv).MAX_TREES_PER_USER).toBe(3);
    expect(loadConfig({ ...devEnv, MAX_TREES_PER_USER: '5' }).MAX_TREES_PER_USER).toBe(5);
    expect(() => loadConfig({ ...devEnv, MAX_TREES_PER_USER: '0' })).toThrowError(
      /MAX_TREES_PER_USER/,
    );
    expect(() => loadConfig({ ...devEnv, MAX_TREES_PER_USER: '101' })).toThrowError(
      /MAX_TREES_PER_USER/,
    );
  });

  it('parses TRUST_PROXY as a hop count defaulting to 0', () => {
    expect(loadConfig(devEnv).TRUST_PROXY).toBe(0);
    expect(loadConfig({ ...devEnv, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(() => loadConfig({ ...devEnv, TRUST_PROXY: 'true' })).toThrowError(/TRUST_PROXY/);
    expect(() => loadConfig({ ...devEnv, TRUST_PROXY: '-1' })).toThrowError(/TRUST_PROXY/);
    expect(() => loadConfig({ ...devEnv, TRUST_PROXY: '6' })).toThrowError(/TRUST_PROXY/);
    expect(() => loadConfig({ ...devEnv, TRUST_PROXY: '1.5' })).toThrowError(/TRUST_PROXY/);
  });

  it('reports a malformed AUTH_BASE_URL as a config error', () => {
    expect(() => loadConfig({ ...devEnv, AUTH_BASE_URL: 'not a url' })).toThrowError(ConfigError);
    expect(() => loadConfig({ ...devEnv, AUTH_BASE_URL: 'not a url' })).toThrowError(
      /AUTH_BASE_URL/,
    );
  });

  describe('photo settings', () => {
    it('defaults and parses MAX_PHOTO_BYTES_PER_TREE', () => {
      expect(loadConfig(devEnv).MAX_PHOTO_BYTES_PER_TREE).toBe(1_073_741_824);
      expect(
        loadConfig({ ...devEnv, MAX_PHOTO_BYTES_PER_TREE: '5000' }).MAX_PHOTO_BYTES_PER_TREE,
      ).toBe(5000);
    });

    it('makes S3_PUBLIC_ENDPOINT optional', () => {
      expect(loadConfig(devEnv).S3_PUBLIC_ENDPOINT).toBeUndefined();
      expect(
        loadConfig({ ...devEnv, S3_PUBLIC_ENDPOINT: 'http://localhost:8333' }).S3_PUBLIC_ENDPOINT,
      ).toBe('http://localhost:8333');
    });

    it('requires a public https, non-local S3_PUBLIC_ENDPOINT in production', () => {
      expect(() =>
        loadConfig({ ...prodEnv, S3_PUBLIC_ENDPOINT: 'http://r2.example.com' }),
      ).toThrowError(/Must use https in production/);
      expect(() =>
        loadConfig({ ...prodEnv, S3_PUBLIC_ENDPOINT: 'https://localhost:8333' }),
      ).toThrowError(/Must not point to a local host in production/);
      expect(
        loadConfig({ ...prodEnv, S3_PUBLIC_ENDPOINT: 'https://acc.r2.cloudflarestorage.com' })
          .S3_PUBLIC_ENDPOINT,
      ).toBe('https://acc.r2.cloudflarestorage.com');
    });
  });

  it('migrates on start and keeps the auth rate limits on by default', () => {
    const config = loadConfig(devEnv);
    expect(config.MIGRATE_ON_START).toBe(true);
    expect(config.AUTH_RATE_LIMIT_ENABLED).toBe(true);
  });

  it('lets a local or .test stack turn the auth rate limits off (for E2E), and nothing else', () => {
    expect(
      loadConfig({ ...devEnv, AUTH_RATE_LIMIT_ENABLED: 'false' }).AUTH_RATE_LIMIT_ENABLED,
    ).toBe(false);
    expect(() =>
      loadConfig({
        ...devEnv,
        AUTH_BASE_URL: 'https://api.example.com',
        AUTH_RATE_LIMIT_ENABLED: 'false',
      }),
    ).toThrowError(/AUTH_RATE_LIMIT_ENABLED/);
  });

  it('refuses auth rate limits off in production, and accepts MIGRATE_ON_START=false', () => {
    expect(() => loadConfig({ ...prodEnv, AUTH_RATE_LIMIT_ENABLED: 'false' })).toThrowError(
      /AUTH_RATE_LIMIT_ENABLED/,
    );
    expect(loadConfig({ ...prodEnv, MIGRATE_ON_START: 'false' }).MIGRATE_ON_START).toBe(false);
  });
  describe('Google sign-in', () => {
    const google = {
      GOOGLE_CLIENT_ID: '1234-abc.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'test-only-google-secret',
    };

    it('is off when neither variable is set, or both are blank', () => {
      expect(loadConfig(devEnv).google).toBeNull();
      expect(
        loadConfig({ ...devEnv, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }).google,
      ).toBeNull();
    });

    it('is on when both are set', () => {
      expect(loadConfig({ ...devEnv, ...google }).google).toEqual({
        clientId: google.GOOGLE_CLIENT_ID,
        clientSecret: google.GOOGLE_CLIENT_SECRET,
      });
      expect(loadConfig({ ...prodEnv, ...google }).google).not.toBeNull();
    });

    it('refuses only one of the two', () => {
      expect(() =>
        loadConfig({ ...devEnv, GOOGLE_CLIENT_ID: google.GOOGLE_CLIENT_ID }),
      ).toThrowError(/GOOGLE_CLIENT_SECRET/);
      expect(() =>
        loadConfig({ ...devEnv, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: 'x' }),
      ).toThrowError(/GOOGLE_CLIENT_ID/);
    });

    it('never echoes the secret in the error', () => {
      let message = '';
      try {
        loadConfig({ ...devEnv, GOOGLE_CLIENT_SECRET: google.GOOGLE_CLIENT_SECRET });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toMatch(/GOOGLE_CLIENT_ID/);
      expect(message).not.toContain(google.GOOGLE_CLIENT_SECRET);
    });
  });
});
