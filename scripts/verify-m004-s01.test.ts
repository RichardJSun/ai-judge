import { describe, expect, it } from 'bun:test';
import type { SubmissionDetailResponse } from '../src/types/api';
import {
  assertSubmissionDetailCoverage,
  ensureLocalAppReady,
  formatProofTarget,
  formatVerificationSummary,
  parseVerifierOptions,
  runPhase,
  type LiveVerificationSummary,
  type ProofTarget,
  VerifierPhaseError,
} from './verify-m004-s01';

type EnsureLocalAppReadyOptions = Parameters<typeof ensureLocalAppReady>[0];
type FetchImpl = NonNullable<EnsureLocalAppReadyOptions['fetchImpl']>;
type SpawnImpl = NonNullable<EnsureLocalAppReadyOptions['spawnImpl']>;

function createProofTarget(overrides: Partial<ProofTarget> = {}): ProofTarget {
  return {
    queueId: 'queue-uuid-1',
    queueLabel: 'queue-proof',
    submissionId: 'submission-uuid-1',
    submissionExternalId: 'submission-external-1',
    detailUrl: 'http://localhost:3000/api/queues/queue-uuid-1/submissions/submission-uuid-1',
    questionsUrl: 'http://localhost:3000/api/queues/queue-uuid-1/questions',
    ...overrides,
  };
}

function createSummary(overrides: Partial<LiveVerificationSummary> = {}): LiveVerificationSummary {
  return {
    ...createProofTarget(),
    totalQuestions: 2,
    answeredQuestions: 1,
    missingQuestions: 1,
    ...overrides,
  };
}

function createDetailResponse(): SubmissionDetailResponse {
  return {
    queue: {
      id: 'queue-uuid-1',
      queue_id: 'queue-proof',
      created_at: '2026-03-28T10:00:00.000Z',
    },
    submission: {
      id: 'submission-uuid-1',
      queue_id: 'queue-uuid-1',
      external_id: 'submission-external-1',
      labeling_task_id: null,
      submitted_at: '2026-03-28T10:05:00.000Z',
      created_at: '2026-03-28T10:05:00.000Z',
    },
    summary: {
      totalQuestions: 2,
      answeredQuestions: 1,
      missingQuestions: 1,
    },
    questions: [
      {
        id: 'question-1',
        external_id: 'question-external-1',
        question_type: 'short_text',
        question_text: 'First question?',
        created_at: '2026-03-28T10:01:00.000Z',
        answerState: 'missing',
        answer: null,
        rawAnswer: null,
      },
      {
        id: 'question-2',
        external_id: 'question-external-2',
        question_type: 'short_text',
        question_text: 'Second question?',
        created_at: '2026-03-28T10:02:00.000Z',
        answerState: 'answered',
        answer: 'Answered second.',
        rawAnswer: { value: 'Answered second.' },
      },
    ],
  };
}

function createQueueQuestionsPayload() {
  return [
    {
      id: 'question-1',
      external_id: 'question-external-1',
      question_text: 'First question?',
      question_type: 'short_text',
      created_at: '2026-03-28T10:01:00.000Z',
      assignments: [],
    },
    {
      id: 'question-2',
      external_id: 'question-external-2',
      question_text: 'Second question?',
      question_type: 'short_text',
      created_at: '2026-03-28T10:02:00.000Z',
      assignments: [],
    },
  ];
}

describe('parseVerifierOptions', () => {
  it('requires --base-url when no environment fallback is present', () => {
    expect(() => parseVerifierOptions([], {} as NodeJS.ProcessEnv)).toThrow('--base-url is required.');
  });

  it('rejects malformed base URLs before probing localhost', () => {
    expect(() => parseVerifierOptions(['--base-url', 'localhost:3000'], {} as NodeJS.ProcessEnv)).toThrow(
      '--base-url must be a valid http:// or https:// URL.'
    );
  });

  it('parses timeout and local-startup settings from CLI args', () => {
    expect(
      parseVerifierOptions([
        '--base-url',
        'http://localhost:3000/',
        '--timeout-ms',
        '9000',
        '--startup-timeout-ms',
        '20000',
        '--probe-timeout-ms',
        '250',
        '--poll-ms',
        '750',
      ])
    ).toEqual({
      baseUrl: 'http://localhost:3000',
      timeoutMs: 9000,
      startupTimeoutMs: 20000,
      probeTimeoutMs: 250,
      pollMs: 750,
    });
  });
});

describe('ensureLocalAppReady', () => {
  it('does not spawn a local app when localhost is already reachable', async () => {
    let spawnCalls = 0;

    const guard = await ensureLocalAppReady({
      baseUrl: 'http://localhost:3000',
      fetchImpl: (async () => new Response('[]', { status: 200 })) as unknown as FetchImpl,
      spawnImpl: (() => {
        spawnCalls += 1;
        throw new Error('spawn should not be called');
      }) as unknown as SpawnImpl,
      probeTimeoutMs: 5,
      pollMs: 1,
      startupTimeoutMs: 10,
    });

    expect(guard.autoStarted).toBe(false);
    expect(spawnCalls).toBe(0);
  });

  it('auto-starts bun run dev when localhost is unreachable', async () => {
    const spawnCalls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const child = {
      exitCode: null as number | null,
      unrefCalls: 0,
      killCalls: 0,
      unref() {
        this.unrefCalls += 1;
      },
      kill() {
        this.killCalls += 1;
        this.exitCode = 0;
        return true;
      },
    };

    let fetchCallCount = 0;
    const guard = await ensureLocalAppReady({
      baseUrl: 'http://localhost:3000',
      fetchImpl: (async () => {
        fetchCallCount += 1;
        if (fetchCallCount === 1) {
          throw new TypeError('Unable to connect. Is the computer able to access the url?');
        }

        return new Response('[]', { status: 200 });
      }) as unknown as FetchImpl,
      spawnImpl: ((command: string, args: string[], options: Record<string, unknown>) => {
        spawnCalls.push({ command, args, options });
        return child;
      }) as unknown as SpawnImpl,
      execPath: '/fake/bun',
      env: {} as NodeJS.ProcessEnv,
      probeTimeoutMs: 5,
      pollMs: 1,
      startupTimeoutMs: 10,
    });

    expect(guard.autoStarted).toBe(true);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toEqual({
      command: '/fake/bun',
      args: ['run', 'dev', '--', '--hostname', 'localhost', '--port', '3000'],
      options: expect.objectContaining({
        cwd: process.cwd(),
        detached: true,
        stdio: 'ignore',
      }),
    });

    guard.keepAlive();
    expect(child.unrefCalls).toBe(1);
    expect(child.killCalls).toBe(0);
  });

  it('stops the spawned local app when auto-start times out', async () => {
    const child = {
      exitCode: null as number | null,
      unrefCalls: 0,
      killCalls: 0,
      unref() {
        this.unrefCalls += 1;
      },
      kill() {
        this.killCalls += 1;
        this.exitCode = 0;
        return true;
      },
    };

    await expect(
      ensureLocalAppReady({
        baseUrl: 'http://localhost:3000',
        fetchImpl: (async () => {
          throw new TypeError('Unable to connect. Is the computer able to access the url?');
        }) as unknown as FetchImpl,
        spawnImpl: (() => child) as unknown as SpawnImpl,
        execPath: '/fake/bun',
        env: {} as NodeJS.ProcessEnv,
        probeTimeoutMs: 5,
        pollMs: 1,
        startupTimeoutMs: 2,
      })
    ).rejects.toThrow(
      'Local Next dev server did not become reachable at http://localhost:3000/api/queues within 2ms after auto-start.'
    );

    expect(child.killCalls).toBe(1);
    expect(child.unrefCalls).toBe(1);
  });
});

describe('runPhase', () => {
  it('wraps failures with the phase name and explicit detail URL context', async () => {
    await expect(
      runPhase(
        'detail-fetch',
        {
          queueId: 'queue-1',
          submissionId: 'submission-1',
          detailUrl: 'http://localhost:3000/api/queues/queue-1/submissions/submission-1',
        },
        async () => {
          throw new Error('Failed to load submission detail. URL under test: http://localhost:3000/api/queues/queue-1/submissions/submission-1');
        }
      )
    ).rejects.toThrow(
      '[verify:m004-s01] phase=detail-fetch queueId=queue-1 submissionId=submission-1 detailUrl=http://localhost:3000/api/queues/queue-1/submissions/submission-1 Failed to load submission detail. URL under test: http://localhost:3000/api/queues/queue-1/submissions/submission-1'
    );
  });

  it('preserves existing VerifierPhaseError instances', async () => {
    const failure = new VerifierPhaseError('question-coverage', 'Submission detail returned 1 questions but 2 queue questions exist.', {
      queueId: 'queue-1',
      detailUrl: 'http://localhost:3000/api/queues/queue-1/submissions/submission-1',
    });

    await expect(
      runPhase('question-coverage', { queueId: 'queue-1' }, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });
});

describe('assertSubmissionDetailCoverage', () => {
  it('accepts a truthful detail payload that covers the full queue question set', () => {
    expect(() => assertSubmissionDetailCoverage(createDetailResponse(), createQueueQuestionsPayload())).not.toThrow();
  });

  it('allows a live queue where there are zero missing answers', () => {
    const detail = createDetailResponse();
    detail.summary = {
      totalQuestions: 2,
      answeredQuestions: 2,
      missingQuestions: 0,
    };
    detail.questions = detail.questions.map((question) => ({
      ...question,
      answerState: 'answered' as const,
      answer: question.answer ?? 'Filled answer',
      rawAnswer: question.rawAnswer ?? { value: 'Filled answer' },
    }));

    expect(() => assertSubmissionDetailCoverage(detail, createQueueQuestionsPayload())).not.toThrow();
  });

  it('rejects malformed queue-question payloads before comparison', () => {
    expect(() => assertSubmissionDetailCoverage(createDetailResponse(), { questions: [] })).toThrow(
      'Malformed queue questions response.'
    );
  });

  it('rejects summary drift between derived counts and the payload summary', () => {
    const detail = createDetailResponse();
    detail.summary.answeredQuestions = 2;

    expect(() => assertSubmissionDetailCoverage(detail, createQueueQuestionsPayload())).toThrow(
      'Submission detail summary answeredQuestions=2 did not match derived answered count 1.'
    );
  });

  it('rejects question coverage drift against the queue questions contract', () => {
    const questions = createQueueQuestionsPayload();
    questions[1] = {
      ...questions[1],
      id: 'question-9',
    };

    expect(() => assertSubmissionDetailCoverage(createDetailResponse(), questions)).toThrow(
      'Submission detail question order drifted at index 1: expected question-9 but received question-2.'
    );
  });
});

describe('summary helpers', () => {
  it('formats the emitted proof target in a stable order', () => {
    expect(formatProofTarget(createProofTarget())).toBe(
      'queue=queue-uuid-1 queueLabel=queue-proof submission=submission-uuid-1 submissionExternalId=submission-external-1 detailUrl=http://localhost:3000/api/queues/queue-uuid-1/submissions/submission-uuid-1 questionsUrl=http://localhost:3000/api/queues/queue-uuid-1/questions'
    );
  });

  it('formats the final summary with stable proof-target and summary counters', () => {
    expect(formatVerificationSummary(createSummary())).toBe(
      'queue=queue-uuid-1 queueLabel=queue-proof submission=submission-uuid-1 submissionExternalId=submission-external-1 detailUrl=http://localhost:3000/api/queues/queue-uuid-1/submissions/submission-uuid-1 questionsUrl=http://localhost:3000/api/queues/queue-uuid-1/questions summary=1/1/2'
    );
  });
});
