import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const devEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://family:family@localhost:5432/family',
  WEB_ORIGIN: 'http://localhost:5173',
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
  SESSION_SECRET: 'k3J9xQ2vL8mN4pR7tW1yZ6bC5dF0gH2jK4lM8nP3qS',
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

  it('rejects automatic bucket creation in production', () => {
    expect(() => loadConfig({ ...prodEnv, S3_CREATE_BUCKET: 'true' })).toThrowError(
      /S3_CREATE_BUCKET/,
    );
  });
});
