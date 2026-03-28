import { describe, expect, it } from 'bun:test';
import { executeRun, type ExecuteRunDeps, type RunExecutionTask } from '@/lib/run/execute-run';

function createTask(overrides: Partial<RunExecutionTask> = {}): RunExecutionTask {
  return {
    evaluationId: 'evaluation-1',
    submissionId: 'submission-1',
    questionText: 'How would you answer?',
    questionType: 'short_text',
    answerJson: { value: 'answer' },
    judge: {
      id: 'judge-1',
      name: 'Judge One',
      system_prompt: 'Be precise.',
      model: 'gateway/model-a',
    },
    promptFields: ['questionText', 'answer'],
    ...overrides,
  };
}

function createExecuteRunDeps(overrides: Partial<ExecuteRunDeps> = {}) {
  const state = {
    completed: [] as string[],
    errored: [] as string[],
    updatedStatuses: [] as Array<{ runId: string; status: 'completed' | 'error' }>,
    markedError: [] as string[],
    seenConcurrency: [] as number[],
  };

  const deps: ExecuteRunDeps = {
    async evaluate() {},
    async incrementCompleted(runId) {
      state.completed.push(runId);
    },
    async incrementErrored(runId) {
      state.errored.push(runId);
    },
    async getRunSummary() {
      return {
        total: state.completed.length + state.errored.length,
        errored: state.errored.length,
      };
    },
    async updateRunStatus(runId, status) {
      state.updatedStatuses.push({ runId, status });
    },
    async markRunError(runId) {
      state.markedError.push(runId);
    },
    async runWithConcurrency(items, concurrency, worker) {
      state.seenConcurrency.push(concurrency);
      for (const item of items) {
        await worker(item);
      }
    },
    ...overrides,
  };

  return { deps, state };
}

describe('executeRun', () => {
  it('keeps bounded concurrency and finalizes a successful run as completed', async () => {
    const tasks = [createTask(), createTask({ evaluationId: 'evaluation-2' })];
    const { deps, state } = createExecuteRunDeps();

    await executeRun({ runId: 'run-1', tasks, deps });

    expect(state.seenConcurrency).toEqual([5]);
    expect(state.completed).toEqual(['run-1', 'run-1']);
    expect(state.errored).toEqual([]);
    expect(state.updatedStatuses).toEqual([{ runId: 'run-1', status: 'completed' }]);
    expect(state.markedError).toEqual([]);
  });

  it('counts task failures and still completes the run when some evaluations succeed', async () => {
    const tasks = [createTask(), createTask({ evaluationId: 'evaluation-2' })];
    const { deps, state } = createExecuteRunDeps({
      async evaluate(task) {
        if (task.evaluationId === 'evaluation-2') {
          throw new Error('gateway timeout');
        }
      },
    });

    await executeRun({ runId: 'run-2', tasks, deps, concurrency: 2 });

    expect(state.seenConcurrency).toEqual([2]);
    expect(state.completed).toEqual(['run-2']);
    expect(state.errored).toEqual(['run-2']);
    expect(state.updatedStatuses).toEqual([{ runId: 'run-2', status: 'completed' }]);
    expect(state.markedError).toEqual([]);
  });

  it('finalizes the run as error when every evaluation errors', async () => {
    const tasks = [createTask(), createTask({ evaluationId: 'evaluation-2' })];
    const { deps, state } = createExecuteRunDeps({
      async evaluate() {
        throw new Error('gateway unavailable');
      },
    });

    await executeRun({ runId: 'run-3', tasks, deps });

    expect(state.completed).toEqual([]);
    expect(state.errored).toEqual(['run-3', 'run-3']);
    expect(state.updatedStatuses).toEqual([{ runId: 'run-3', status: 'error' }]);
    expect(state.markedError).toEqual([]);
  });

  it('marks the persisted run as error when finalization fails', async () => {
    const { deps, state } = createExecuteRunDeps({
      async getRunSummary() {
        throw new Error('summary read failed');
      },
    });

    await executeRun({ runId: 'run-4', tasks: [createTask()], deps });

    expect(state.markedError).toEqual(['run-4']);
    expect(state.updatedStatuses).toEqual([]);
  });

  it('treats an empty run as completed instead of error', async () => {
    const { deps, state } = createExecuteRunDeps({
      async getRunSummary() {
        return { total: 0, errored: 0 };
      },
    });

    await executeRun({ runId: 'run-5', tasks: [], deps });

    expect(state.updatedStatuses).toEqual([{ runId: 'run-5', status: 'completed' }]);
    expect(state.markedError).toEqual([]);
  });
});
