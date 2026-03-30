-- Enable row-level security on all PostgREST-exposed public tables.
--
-- This app talks to Supabase through Next.js API routes using the service-role key,
-- so browser clients do not need direct anon/authenticated table policies. Enabling
-- RLS without adding permissive public policies closes direct PostgREST access while
-- preserving the existing server-side service-role architecture.

ALTER TABLE queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE judges ENABLE ROW LEVEL SECURITY;
ALTER TABLE judge_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_attachments ENABLE ROW LEVEL SECURITY;
