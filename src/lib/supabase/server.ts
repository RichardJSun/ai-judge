import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let serviceClient: SupabaseClient | null = null;

function requireEnv(name: string, value: string | undefined) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function resolveServiceClientEnv() {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secretKey) {
    throw new Error(
      'Missing required environment variable: SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  return { url, secretKey };
}

export function resetServiceClientForTests() {
  serviceClient = null;
}

export function createServiceClient() {
  if (!serviceClient) {
    const { url, secretKey } = resolveServiceClientEnv();
    serviceClient = createClient(url, secretKey);
  }

  return serviceClient;
}
