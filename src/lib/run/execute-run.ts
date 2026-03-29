import type { EvaluateParams } from '@/lib/ai/evaluator';

export type RunExecutionTask = EvaluateParams;

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

    const finalStatus = resolveFinalRunStatus(await options.deps.getRunSummary(options.runId));
    await options.deps.updateRunStatus(options.runId, finalStatus);
  } catch {
    await options.deps.markRunError(options.runId);
  }
}

function resolveFinalRunStatus(summary: { total: number; errored: number }): 'completed' | 'error' {
  return summary.total > 0 && summary.errored === summary.total ? 'error' : 'completed';
}
