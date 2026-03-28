import type { SupabaseClient } from '@supabase/supabase-js';
import type { ValidatedSubmission } from '@/lib/validators/upload';

interface ParseResult {
  queues: number;
  submissions: number;
  questions: number;
  answers: number;
}

export async function persistSubmissions(
  supabase: SupabaseClient,
  items: ValidatedSubmission[]
): Promise<ParseResult> {
  const counts: ParseResult = { queues: 0, submissions: 0, questions: 0, answers: 0 };

  // Collect unique queue IDs
  const queueIds = [...new Set(items.map((s) => s.queueId))];

  // 1. Upsert all queues in one call
  const { data: queues, error: queueErr } = await supabase
    .from('queues')
    .upsert(
      queueIds.map((qid) => ({ queue_id: qid })),
      { onConflict: 'queue_id', ignoreDuplicates: false }
    )
    .select('id, queue_id');
  if (queueErr) throw new Error(`Queue upsert failed: ${queueErr.message}`);

  counts.queues = queues?.length ?? 0;
  const queueMap = new Map((queues ?? []).map((q: { queue_id: string; id: string }) => [q.queue_id, q.id]));

  // 2. Collect and upsert all question templates in one call
  const allQuestionRows: { queue_id: string; external_id: string; question_type: string | null; question_text: string }[] = [];
  for (const item of items) {
    const queueUuid = queueMap.get(item.queueId);
    if (!queueUuid) continue;
    for (const q of item.questions) {
      allQuestionRows.push({
        queue_id: queueUuid,
        external_id: q.data.id,
        question_type: q.data.questionType ?? null,
        question_text: q.data.questionText,
      });
    }
  }

  if (allQuestionRows.length > 0) {
    // Deduplicate by queue_id + external_id (keep last)
    const dedupMap = new Map(allQuestionRows.map((r) => [`${r.queue_id}::${r.external_id}`, r]));
    const uniqueQuestions = [...dedupMap.values()];

    const { data: qtData, error: qtErr } = await supabase
      .from('question_templates')
      .upsert(uniqueQuestions, { onConflict: 'queue_id,external_id', ignoreDuplicates: false })
      .select('id, external_id, queue_id');
    if (qtErr) throw new Error(`Question template upsert failed: ${qtErr.message}`);
    counts.questions = qtData?.length ?? 0;
  }

  // 3. Upsert all submissions in one call
  const submissionRows = items
    .map((item) => {
      const queueUuid = queueMap.get(item.queueId);
      if (!queueUuid) return null;
      return {
        queue_id: queueUuid,
        external_id: item.id,
        labeling_task_id: item.labelingTaskId ?? null,
        submitted_at: item.createdAt ? new Date(item.createdAt).toISOString() : null,
        raw_json: item,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (submissionRows.length > 0) {
    const { data: subData, error: subErr } = await supabase
      .from('submissions')
      .upsert(submissionRows, { onConflict: 'queue_id,external_id', ignoreDuplicates: false })
      .select('id, external_id, queue_id');
    if (subErr) throw new Error(`Submission upsert failed: ${subErr.message}`);
    counts.submissions = subData?.length ?? 0;

    // 4. Fetch all question template IDs once for answer mapping
    const affectedQueueUuids = [...new Set(submissionRows.map((r) => r.queue_id))];
    const { data: qtRows } = await supabase
      .from('question_templates')
      .select('id, external_id, queue_id')
      .in('queue_id', affectedQueueUuids);

    const qtMap = new Map(
      (qtRows ?? []).map((qt: { id: string; external_id: string; queue_id: string }) => [
        `${qt.queue_id}::${qt.external_id}`,
        qt.id,
      ])
    );

    const subMap = new Map(
      (subData ?? []).map((s: { id: string; external_id: string; queue_id: string }) => [
        `${s.queue_id}::${s.external_id}`,
        s.id,
      ])
    );

    // 5. Build and upsert all answers in one call
    const allAnswerRows: { submission_id: string; question_template_id: string; answer_json: unknown }[] = [];
    for (const item of items) {
      const queueUuid = queueMap.get(item.queueId);
      if (!queueUuid) continue;
      const submissionId = subMap.get(`${queueUuid}::${item.id}`);
      if (!submissionId) continue;

      for (const [questionExternalId, answerData] of Object.entries(item.answers)) {
        const qtId = qtMap.get(`${queueUuid}::${questionExternalId}`);
        if (!qtId) continue;
        allAnswerRows.push({
          submission_id: submissionId,
          question_template_id: qtId,
          answer_json: answerData,
        });
      }
    }

    if (allAnswerRows.length > 0) {
      const { error: ansErr } = await supabase
        .from('submission_answers')
        .upsert(allAnswerRows, { onConflict: 'submission_id,question_template_id', ignoreDuplicates: true });
      if (ansErr) throw new Error(`Answer upsert failed: ${ansErr.message}`);
      counts.answers = allAnswerRows.length;
    }
  }

  return counts;
}
