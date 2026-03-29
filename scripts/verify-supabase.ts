import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SUBMISSION_ATTACHMENT_STORAGE_BUCKET } from '../src/lib/submissions/attachment-storage';

const execFileAsync = promisify(execFile);

const REQUIRED_TABLES = [
  'queues',
  'question_templates',
  'submissions',
  'submission_answers',
  'judges',
  'judge_assignments',
  'evaluation_runs',
  'evaluations',
  'submission_attachments',
] as const;

function stripOptionalQuotes(value: string) {
  return value.replace(/^"|"$/g, '');
}

function isLocalBaseUrl(baseUrl: string) {
  try {
    const parsed = new URL(baseUrl);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export async function maybeReadLocalSupabaseEnv(baseUrl: string) {
  if (!isLocalBaseUrl(baseUrl)) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync('bunx', ['supabase', 'status', '-o', 'env']);
    const envMap = new Map<string, string>();

    for (const line of stdout.split(/\r?\n/)) {
      const sep = line.indexOf('=');
      if (sep <= 0) {
        continue;
      }

      const key = line.slice(0, sep);
      const value = stripOptionalQuotes(line.slice(sep + 1));
      envMap.set(key, value);
    }

    const url = envMap.get('API_URL');
    const secret = envMap.get('SECRET_KEY') ?? envMap.get('SERVICE_ROLE_KEY');

    if (!url || !secret) {
      return null;
    }

    return { url, secret };
  } catch {
    return null;
  }
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export async function createSupabaseServiceClient(baseUrl: string) {
  const localEnv = await maybeReadLocalSupabaseEnv(baseUrl);
  const url = localEnv?.url ?? requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const secret = localEnv?.secret ?? process.env.SUPABASE_SECRET_KEY ?? requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  return createClient(url, secret);
}

export async function assertTableReadable(
  supabase: SupabaseClient,
  table: (typeof REQUIRED_TABLES)[number]
) {
  const { error } = await supabase.from(table).select('id').limit(1);
  if (error) {
    throw new Error(error.message ?? `Supabase table ${table} is not readable.`);
  }
}

export async function assertStorageBucketReady(supabase: SupabaseClient) {
  const { data, error } = await supabase.storage.getBucket(SUBMISSION_ATTACHMENT_STORAGE_BUCKET);
  if (error) {
    throw new Error(error.message ?? `Supabase storage bucket ${SUBMISSION_ATTACHMENT_STORAGE_BUCKET} is missing.`);
  }

  if (!data) {
    throw new Error(`Supabase storage bucket ${SUBMISSION_ATTACHMENT_STORAGE_BUCKET} could not be loaded.`);
  }
}

export { REQUIRED_TABLES };
