'use client';

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo } from 'react';
import ReviewerWayfinding, {
  createQueueReviewerBreadcrumbs,
} from '@/components/navigation/ReviewerWayfinding';
import ReviewerPagination from '@/components/pagination/ReviewerPagination';
import PassRateChart from '@/components/results/PassRateChart';
import ResultsFilters from '@/components/results/ResultsFilters';
import ResultsTable from '@/components/results/ResultsTable';
import { fetchJson, parseResultsResponse } from '@/lib/results/fetch-json';
import type {
  ResultsFilterJudge,
  ResultsFilterQuestion,
  ResultsResponse,
} from '@/types/api';
import type { VerdictEnum } from '@/types/db';

const SAFE_RESULTS_ERROR = 'Failed to load queue results.';
const VALID_VERDICTS: readonly VerdictEnum[] = ['pass', 'fail', 'inconclusive'];
const RESULTS_FILTER_PARAM_KEYS = new Set(['page', 'judgeId', 'questionId', 'verdict']);

export type ResultsPageSearchParams = Record<string, string | string[] | undefined>;

type ResultsPageParamValue = string | string[] | undefined;

export interface ResultsPageUrlState {
  page: number;
  selectedJudges: string[];
  selectedQuestions: string[];
  selectedVerdicts: VerdictEnum[];
}

export interface ResultsPageContentProps {
  queueId: string;
  judges: ResultsFilterJudge[];
  questions: ResultsFilterQuestion[];
  availableVerdicts: VerdictEnum[];
  results?: ResultsResponse;
  isInitialLoading: boolean;
  loadError: Error | null;
  selectedJudges: string[];
  selectedQuestions: string[];
  selectedVerdicts: VerdictEnum[];
  page: number;
  onBack: () => void;
  onRetry: () => void | Promise<unknown>;
  onJudgesChange: (value: string[]) => void;
  onQuestionsChange: (value: string[]) => void;
  onVerdictsChange: (value: VerdictEnum[]) => void;
  getPageHref?: (page: number) => string;
}

function fetchResults(queueId: string, filterQueryString: string) {
  return fetchJson(`/api/queues/${queueId}/results?${filterQueryString}`, {
    fallbackMessage: SAFE_RESULTS_ERROR,
    parse: (value) => parseResultsResponse(value, `/api/queues/${queueId}/results response`),
  });
}

function normalizeResultsPageParam(value: ResultsPageParamValue) {
  const candidate = Array.isArray(value) ? value[0] : value;

  if (typeof candidate !== 'string') {
    return 1;
  }

  const trimmed = candidate.trim();

  if (!/^[1-9]\d*$/.test(trimmed)) {
    return 1;
  }

  const parsed = BigInt(trimmed);
  const maxSafePage = BigInt(Number.MAX_SAFE_INTEGER);

  if (parsed > maxSafePage) {
    return 1;
  }

  return Number(parsed);
}

function normalizeSearchParamList(value: ResultsPageParamValue) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map((candidate) => candidate.trim()).filter((candidate) => candidate.length > 0))];
}

export function normalizeResultsPageSearchParams(searchParams: ResultsPageSearchParams): ResultsPageUrlState {
  const verdicts = normalizeSearchParamList(searchParams.verdict).filter(
    (candidate): candidate is VerdictEnum => VALID_VERDICTS.includes(candidate as VerdictEnum)
  );

  return {
    page: normalizeResultsPageParam(searchParams.page),
    selectedJudges: normalizeSearchParamList(searchParams.judgeId),
    selectedQuestions: normalizeSearchParamList(searchParams.questionId),
    selectedVerdicts: verdicts,
  };
}

export function buildResultsQueryString(state: ResultsPageUrlState) {
  const searchParams = new URLSearchParams();
  searchParams.set('page', String(state.page));

  for (const judgeId of state.selectedJudges) {
    searchParams.append('judgeId', judgeId);
  }

  for (const questionId of state.selectedQuestions) {
    searchParams.append('questionId', questionId);
  }

  for (const verdict of state.selectedVerdicts) {
    searchParams.append('verdict', verdict);
  }

  return searchParams.toString();
}

export function buildResultsPageHref(
  pathname: string,
  searchParams: ResultsPageSearchParams,
  state: ResultsPageUrlState
) {
  const nextSearchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (RESULTS_FILTER_PARAM_KEYS.has(key) || value == null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const candidate of value) {
        nextSearchParams.append(key, candidate);
      }
      continue;
    }

    nextSearchParams.set(key, value);
  }

  nextSearchParams.set('page', String(state.page));

  for (const judgeId of state.selectedJudges) {
    nextSearchParams.append('judgeId', judgeId);
  }

  for (const questionId of state.selectedQuestions) {
    nextSearchParams.append('questionId', questionId);
  }

  for (const verdict of state.selectedVerdicts) {
    nextSearchParams.append('verdict', verdict);
  }

  const query = nextSearchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function hasCanonicalSingleValue(value: ResultsPageParamValue, expected: string) {
  return typeof value === 'string' && value === expected;
}

function hasCanonicalListValue(value: ResultsPageParamValue, expected: readonly string[]) {
  if (expected.length === 0) {
    return typeof value === 'undefined';
  }

  if (typeof value === 'string') {
    return expected.length === 1 && value === expected[0];
  }

  if (!Array.isArray(value)) {
    return false;
  }

  return value.length === expected.length && value.every((candidate, index) => candidate === expected[index]);
}

export function resolveResultsPageSyncHref(
  pathname: string,
  searchParams: ResultsPageSearchParams,
  state: ResultsPageUrlState
) {
  const pageIsCanonical = hasCanonicalSingleValue(searchParams.page, String(state.page));
  const judgesAreCanonical = hasCanonicalListValue(searchParams.judgeId, state.selectedJudges);
  const questionsAreCanonical = hasCanonicalListValue(searchParams.questionId, state.selectedQuestions);
  const verdictsAreCanonical = hasCanonicalListValue(searchParams.verdict, state.selectedVerdicts);

  if (pageIsCanonical && judgesAreCanonical && questionsAreCanonical && verdictsAreCanonical) {
    return null;
  }

  return buildResultsPageHref(pathname, searchParams, state);
}

export function createResultsPageCanonicalState(
  requestedState: ResultsPageUrlState,
  results: Pick<ResultsResponse, 'page' | 'filterMetadata'>
): ResultsPageUrlState {
  const allowedJudgeIds = new Set(results.filterMetadata.judges.map((judge) => judge.id));
  const allowedQuestionIds = new Set(results.filterMetadata.questions.map((question) => question.id));
  const allowedVerdicts = new Set(results.filterMetadata.verdicts);

  return {
    page: results.page,
    selectedJudges: requestedState.selectedJudges.filter((judgeId) => allowedJudgeIds.has(judgeId)),
    selectedQuestions: requestedState.selectedQuestions.filter((questionId) => allowedQuestionIds.has(questionId)),
    selectedVerdicts: requestedState.selectedVerdicts.filter((verdict) => allowedVerdicts.has(verdict)),
  };
}

export function getResultsPageQueryKey(queueId: string, state: ResultsPageUrlState) {
  return [
    'results',
    queueId,
    state.page,
    state.selectedJudges,
    state.selectedQuestions,
    state.selectedVerdicts,
  ] as const;
}

function areStringListsEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function areResultsPageStatesEqual(left: ResultsPageUrlState, right: ResultsPageUrlState) {
  return (
    left.page === right.page &&
    areStringListsEqual(left.selectedJudges, right.selectedJudges) &&
    areStringListsEqual(left.selectedQuestions, right.selectedQuestions) &&
    areStringListsEqual(left.selectedVerdicts, right.selectedVerdicts)
  );
}

function getCompletedEvaluationCount(results: ResultsResponse) {
  return results.judgePassRates.reduce((sum, judge) => sum + judge.total, 0);
}

function getPassRateSummary(results: ResultsResponse) {
  const completedTotal = getCompletedEvaluationCount(results);

  if (results.total === 0) {
    return 'No evaluations match the current filters.';
  }

  if (completedTotal === 0) {
    return `${results.total} matching evaluation${results.total === 1 ? '' : 's'} found, but none have completed yet, so the pass rate remains 0%.`;
  }

  return `Pass rate is based on ${completedTotal} completed evaluation${completedTotal === 1 ? '' : 's'} out of ${results.total} matching the current filters.`;
}

export function ResultsPageContent({
  queueId,
  judges,
  questions,
  availableVerdicts,
  results,
  isInitialLoading,
  loadError,
  selectedJudges,
  selectedQuestions,
  selectedVerdicts,
  page,
  onBack,
  onRetry,
  onJudgesChange,
  onQuestionsChange,
  onVerdictsChange,
  getPageHref = (nextPage) => `/queues/${queueId}/results?page=${nextPage}`,
}: ResultsPageContentProps) {
  const chartData = results?.judgePassRates ?? [];
  const completedEvaluations = results ? getCompletedEvaluationCount(results) : 0;

  return (
    <>
      <ReviewerWayfinding
        title="Results"
        backLabel="Back to queue"
        onBack={onBack}
        breadcrumbs={createQueueReviewerBreadcrumbs(queueId, 'Results')}
      />

      <Box mb={2}>
        <ResultsFilters
          judges={judges}
          questions={questions}
          availableVerdicts={availableVerdicts}
          selectedJudges={selectedJudges}
          selectedQuestions={selectedQuestions}
          selectedVerdicts={selectedVerdicts}
          onJudgesChange={onJudgesChange}
          onQuestionsChange={onQuestionsChange}
          onVerdictsChange={onVerdictsChange}
        />
      </Box>

      {isInitialLoading ? (
        <Box display="flex" justifyContent="center" mt={6}>
          <CircularProgress />
        </Box>
      ) : loadError ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void onRetry()}>
              Retry
            </Button>
          }
        >
          {loadError.message}
        </Alert>
      ) : results ? (
        <>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems={{ md: 'stretch' }}>
              <Box minWidth={{ xs: '100%', md: 220 }}>
                <Typography variant="h3" fontWeight={800} color="primary.main">
                  {results.passRate}%
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Pass rate across completed evaluations in the current filter set.
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                  {getPassRateSummary(results)}
                </Typography>
              </Box>
              <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', md: 'block' } }} />
              <Box flex={1} minWidth={0}>
                <PassRateChart
                  data={chartData}
                  matchingTotal={results.total}
                  completedTotal={completedEvaluations}
                />
              </Box>
            </Stack>
          </Paper>

          <ResultsTable queueId={queueId} evaluations={results.evaluations} />

          <Box mt={2}>
            <ReviewerPagination
              page={page}
              pageSize={results.pageSize}
              total={results.total}
              getHref={getPageHref}
            />
          </Box>
        </>
      ) : (
        <Alert severity="error">Results data did not load.</Alert>
      )}
    </>
  );
}

export default function ResultsPageClient({
  queueId,
  searchParams,
}: {
  queueId: string;
  searchParams: ResultsPageSearchParams;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const requestedState = useMemo(() => normalizeResultsPageSearchParams(searchParams), [searchParams]);
  const requestedQueryString = useMemo(() => buildResultsQueryString(requestedState), [requestedState]);

  const { data: results, isLoading, error, refetch } = useQuery<ResultsResponse, Error>({
    queryKey: getResultsPageQueryKey(queueId, requestedState),
    queryFn: () => fetchResults(queueId, requestedQueryString),
    retry: false,
  });

  const canonicalState = useMemo(
    () => (results ? createResultsPageCanonicalState(requestedState, results) : requestedState),
    [requestedState, results]
  );

  useEffect(() => {
    if (!results || areResultsPageStatesEqual(requestedState, canonicalState)) {
      return;
    }

    queryClient.setQueryData<ResultsResponse>(getResultsPageQueryKey(queueId, canonicalState), results);
  }, [canonicalState, queryClient, queueId, requestedState, results]);

  useEffect(() => {
    if (!results) {
      return;
    }

    const syncHref = resolveResultsPageSyncHref(pathname, searchParams, canonicalState);
    if (syncHref) {
      router.replace(syncHref, { scroll: false });
    }
  }, [canonicalState, pathname, results, router, searchParams]);

  const updateUrlState = useCallback(
    (nextState: ResultsPageUrlState) => {
      router.replace(buildResultsPageHref(pathname, searchParams, nextState), { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const getPageHref = useCallback(
    (nextPage: number) => buildResultsPageHref(pathname, searchParams, { ...canonicalState, page: nextPage }),
    [canonicalState, pathname, searchParams]
  );

  return (
    <ResultsPageContent
      queueId={queueId}
      judges={results?.filterMetadata.judges ?? []}
      questions={results?.filterMetadata.questions ?? []}
      availableVerdicts={results?.filterMetadata.verdicts ?? []}
      results={results}
      isInitialLoading={isLoading && !results}
      loadError={error}
      selectedJudges={canonicalState.selectedJudges}
      selectedQuestions={canonicalState.selectedQuestions}
      selectedVerdicts={canonicalState.selectedVerdicts}
      page={canonicalState.page}
      onBack={() => router.push(`/queues/${queueId}`)}
      onRetry={() => refetch()}
      onJudgesChange={(value) =>
        updateUrlState({
          ...canonicalState,
          selectedJudges: [...new Set(value)],
          page: 1,
        })
      }
      onQuestionsChange={(value) =>
        updateUrlState({
          ...canonicalState,
          selectedQuestions: [...new Set(value)],
          page: 1,
        })
      }
      onVerdictsChange={(value) =>
        updateUrlState({
          ...canonicalState,
          selectedVerdicts: value.filter((candidate, index, list) => list.indexOf(candidate) === index),
          page: 1,
        })
      }
      getPageHref={getPageHref}
    />
  );
}
