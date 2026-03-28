import { afterEach, describe, expect, it } from 'bun:test';
import {
  createServiceClient,
  resetServiceClientForTests,
  resolveServiceClientEnv,
} from '@/lib/supabase/server';

const ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Record<
  (typeof ENV_KEYS)[number],
  string | undefined
>;
const SUPABASE_URL = 'https://example.supabase.co';

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const key of ENV_KEYS) {
    const nextValue = values[key];

    if (nextValue === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = nextValue;
  }
}

afterEach(() => {
  resetServiceClientForTests();
  setEnv(ORIGINAL_ENV);
});

describe('resolveServiceClientEnv', () => {
  it('prefers SUPABASE_SECRET_KEY when both secret env vars are present', () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      SUPABASE_SECRET_KEY: 'secret-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    });

    expect(resolveServiceClientEnv()).toEqual({
      url: SUPABASE_URL,
      secretKey: 'secret-key',
    });
  });

  it('falls back to SUPABASE_SERVICE_ROLE_KEY when SUPABASE_SECRET_KEY is missing', () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      SUPABASE_SECRET_KEY: undefined,
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    });

    expect(resolveServiceClientEnv()).toEqual({
      url: SUPABASE_URL,
      secretKey: 'service-role-key',
    });
  });

  it('fails fast when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: undefined,
      SUPABASE_SECRET_KEY: 'secret-key',
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    });

    expect(() => resolveServiceClientEnv()).toThrow(
      'Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL'
    );
  });

  it('fails fast when both service secret env vars are missing', () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      SUPABASE_SECRET_KEY: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    });

    expect(() => resolveServiceClientEnv()).toThrow(
      'Missing required environment variable: SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY'
    );
  });

  it('treats an empty preferred secret as malformed instead of silently falling back', () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      SUPABASE_SECRET_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    });

    expect(() => resolveServiceClientEnv()).toThrow(
      'Missing required environment variable: SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY'
    );
  });
});

describe('createServiceClient', () => {
  it('reuses one client instance while env remains stable', () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      SUPABASE_SECRET_KEY: 'secret-key',
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    });

    const firstClient = createServiceClient();
    const secondClient = createServiceClient();

    expect(firstClient).toBe(secondClient);
  });
});
