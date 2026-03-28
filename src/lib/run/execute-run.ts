export interface RunExecutionTask {
  evaluationId: string;
  submissionId: string;
  questionText: string;
  questionType: string | null;
  answerJson: Record<string, unknown>;
  judge: {
    id: string;
    name: string;
    system_prompt: string;
    model: string;
  };
  promptFields: string[];
}

export interface ExecuteRunDeps {
  evaluate(task: RunExecutionTask): Promise<void>;
  incrementCompleted(runId: string): Promise<void>;
  incrementErrored(runId: string): Promise<void>;
  getRunSummary(runId: string): Promise<{ total: number; errored: number }>;
  updateRunStatus(runId: string, status: 'completed' | 'error'): Promise<void>;
  markRunError(runId: string): Promise<void>;
  runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>
  ): Promise<void>;
}

export interface ExecuteRunOptions {
  runId: string;
  tasks: RunExecutionTask[];
  deps: ExecuteRunDeps;
  concurrency?: number;
}

export async function executeRun(options: ExecuteRunOptions): Promise<void> {
  const concurrency = options.concurrency ?? 5;

  try {
    await options.deps.runWithConcurrency(options.tasks, concurrency, async (task) => {
      try {
        await options.deps.evaluate(task);
        await options.deps.incrementCompleted(options.runId);
      } catch {
        await options.deps.incrementErrored(options.runId);
      }
    });

    const { total, errored } = await options.deps.getRunSummary(options.runId);
    const finalStatus = total > 0 && errored === total ? 'error' : 'completed';
    await options.deps.updateRunStatus(options.runId, finalStatus);
  } catch {
    await options.deps.markRunError(options.runId);
  }
}
