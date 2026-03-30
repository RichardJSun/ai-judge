import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('./0003_enable_public_rls.sql', import.meta.url), 'utf8');

const PUBLIC_TABLES = [
  'queues',
  'submissions',
  'question_templates',
  'submission_answers',
  'judges',
  'judge_assignments',
  'evaluation_runs',
  'evaluations',
  'submission_attachments',
] as const;

describe('0003_enable_public_rls migration', () => {
  it('enables row level security on every PostgREST-exposed public table', () => {
    for (const table of PUBLIC_TABLES) {
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    }
  });

  it('does not add anon/authenticated policies because the app uses server-side service-role access', () => {
    expect(migration).not.toContain('CREATE POLICY');
  });
});
