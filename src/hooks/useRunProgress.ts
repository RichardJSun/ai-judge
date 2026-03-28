'use client';

import { useEffect, useState } from 'react';
import type { RunProgressResponse } from '@/types/api';

export function useRunProgress(queueId: string, runId: string | null) {
  const [progress, setProgress] = useState<RunProgressResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;

    let cancelled = false;

    async function poll() {
      while (!cancelled) {
        try {
          const res = await fetch(`/api/queues/${queueId}/runs/${runId}`);
          if (!res.ok) throw new Error('Failed to fetch run status');
          const data: RunProgressResponse = await res.json();
          if (!cancelled) setProgress(data);
          if (data.status === 'completed' || data.status === 'error' || data.status === 'cancelled') {
            break;
          }
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : 'Polling failed');
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    poll();
    return () => { cancelled = true; };
  }, [queueId, runId]);

  return { progress, error };
}
