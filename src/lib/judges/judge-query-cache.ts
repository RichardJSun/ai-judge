import type { QueryClient } from '@tanstack/react-query';
import type { JudgePageResponse } from '@/types/api';
import type { Judge } from '@/types/db';

export function getJudgePageQueryKey(page: number) {
  return ['judges-page', page] as const;
}

export function getJudgePagesQueryKey() {
  return ['judges-page'] as const;
}

export function getJudgeDetailQueryKey(judgeId: string) {
  return ['judge', judgeId] as const;
}

export function getJudgesQueryKey() {
  return ['judges'] as const;
}

export function upsertJudgeInList(current: Judge[] | undefined, nextJudge: Judge): Judge[] {
  if (!current?.length) {
    return [nextJudge];
  }

  let found = false;
  const updated = current.map((judge) => {
    if (judge.id !== nextJudge.id) {
      return judge;
    }

    found = true;
    return nextJudge;
  });

  return found ? updated : [nextJudge, ...updated];
}

export function reconcileSavedJudgePage(
  current: JudgePageResponse | undefined,
  nextJudge: Judge
): JudgePageResponse | undefined {
  if (!current) {
    return current;
  }

  let found = false;
  const judges = current.judges.map((judge) => {
    if (judge.id !== nextJudge.id) {
      return judge;
    }

    found = true;
    return nextJudge;
  });

  if (!found) {
    return current;
  }

  return {
    ...current,
    judges,
  };
}

type JudgeQueryClient = Pick<QueryClient, 'getQueryState' | 'invalidateQueries' | 'setQueryData'> & {
  setQueriesData?: QueryClient['setQueriesData'];
};

export async function reconcileSavedJudgeCaches({
  queryClient,
  page,
  savedJudge,
}: {
  queryClient: JudgeQueryClient;
  page?: number;
  savedJudge: Judge;
}) {
  if (typeof page === 'number') {
    queryClient.setQueryData<JudgePageResponse>(getJudgePageQueryKey(page), (current) =>
      reconcileSavedJudgePage(current, savedJudge)
    );
  } else if (queryClient.setQueriesData) {
    queryClient.setQueriesData<JudgePageResponse>({ queryKey: getJudgePagesQueryKey() }, (current) =>
      reconcileSavedJudgePage(current, savedJudge)
    );
  }

  if (queryClient.getQueryState(getJudgeDetailQueryKey(savedJudge.id))) {
    queryClient.setQueryData(getJudgeDetailQueryKey(savedJudge.id), savedJudge);
  }

  if (queryClient.getQueryState(getJudgesQueryKey())) {
    queryClient.setQueryData<Judge[]>(getJudgesQueryKey(), (current) => upsertJudgeInList(current, savedJudge));
  }

  await queryClient.invalidateQueries({ queryKey: getJudgesQueryKey() });
}
