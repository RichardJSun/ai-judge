'use client';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
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
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { use, useMemo, useState } from 'react';
import PassRateChart from '@/components/results/PassRateChart';
import ResultsFilters from '@/components/results/ResultsFilters';
import ResultsTable from '@/components/results/ResultsTable';
import { parseJudgeList } from '@/lib/judges/judge-lifecycle';
import {
  fetchJson,
  parseResultsFilterQuestionList,
  parseResultsResponse,
  type ResultsFilterQuestion,
} from '@/lib/results/fetch-json';
import type { ResultsResponse } from '@/types/api';
import type { Judge, VerdictEnum } from '@/types/db';

function fetchJudges() {
  return fetchJson('/api/judges', {
    fallbackMessage: 'Failed to load judges.',
    parse: (value) => parseJudgeList(value, '/api/judges response'),
  });
}

function fetchQuestions(queueId: string) {
  return fetchJson(`/api/queues/${queueId}/questions`, {
    fallbackMessage: 'Failed to load queue questions.',
    parse: (value) =>
      parseResultsFilterQuestionList(value, `/api/queues/${queueId}/questions response`),
  });
}

function getResultsQuestionsQueryKey(queueId: string) {
  return ['results-filter-questions', queueId] as const;
}

function fetchResults(queueId: string, filterQueryString: string) {
  return fetchJson(`/api/queues/${queueId}/results?${filterQueryString}`, {
    fallbackMessage: 'Failed to load queue results.',
    parse: (value) => parseResultsResponse(value, `/api/queues/${queueId}/results response`),
  });
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

export default function ResultsPage({ params }: { params: Promise<{ queueId: string }> }) {
  const { queueId } = use(params);
  const router = useRouter();

  const [selectedJudges, setSelectedJudges] = useState<string[]>([]);
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>([]);
  const [selectedVerdicts, setSelectedVerdicts] = useState<VerdictEnum[]>([]);
  const [page, setPage] = useState(1);

  const filterQueryString = useMemo(() => {
    const filterParams = new URLSearchParams({ page: String(page) });

    for (const id of selectedJudges) {
      filterParams.append('judgeId', id);
    }

    for (const id of selectedQuestions) {
      filterParams.append('questionId', id);
    }

    for (const verdict of selectedVerdicts) {
      filterParams.append('verdict', verdict);
    }

    return filterParams.toString();
  }, [page, selectedJudges, selectedQuestions, selectedVerdicts]);

  const {
    data: judges,
    isLoading: judgesLoading,
    error: judgesError,
    refetch: refetchJudges,
  } = useQuery<Judge[], Error>({
    queryKey: ['judges'],
    queryFn: fetchJudges,
  });

  const {
    data: questions,
    isLoading: questionsLoading,
    error: questionsError,
    refetch: refetchQuestions,
  } = useQuery<ResultsFilterQuestion[], Error>({
    queryKey: getResultsQuestionsQueryKey(queueId),
    queryFn: () => fetchQuestions(queueId),
  });

  const {
    data: results,
    isLoading: resultsLoading,
    error: resultsError,
    refetch: refetchResults,
  } = useQuery<ResultsResponse, Error>({
    queryKey: ['results', queueId, filterQueryString],
    queryFn: () => fetchResults(queueId, filterQueryString),
  });

  const chartData = results?.judgePassRates ?? [];
  const completedEvaluations = results ? getCompletedEvaluationCount(results) : 0;
  const loadError = resultsError ?? judgesError ?? questionsError;
  const isInitialLoading =
    (judgesLoading && !judges) ||
    (questionsLoading && !questions) ||
    (resultsLoading && !results);

  async function retryLoads() {
    await Promise.all([refetchJudges(), refetchQuestions(), refetchResults()]);
  }

  return (
    <>
      <Stack direction="row" alignItems="center" spacing={1} mb={3}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => router.push(`/queues/${queueId}`)}>
          Back
        </Button>
        <Typography variant="h4" fontWeight={700}>
          Results
        </Typography>
      </Stack>

      <Box mb={2}>
        <ResultsFilters
          judges={judges ?? []}
          questions={questions ?? []}
          selectedJudges={selectedJudges}
          selectedQuestions={selectedQuestions}
          selectedVerdicts={selectedVerdicts}
          onJudgesChange={(value) => {
            setSelectedJudges(value);
            setPage(1);
          }}
          onQuestionsChange={(value) => {
            setSelectedQuestions(value);
            setPage(1);
          }}
          onVerdictsChange={(value) => {
            setSelectedVerdicts(value);
            setPage(1);
          }}
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
            <Button color="inherit" size="small" onClick={() => void retryLoads()}>
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

          <ResultsTable evaluations={results.evaluations} />

          {results.total > results.pageSize ? (
            <Stack direction="row" spacing={1} justifyContent="center" mt={2}>
              <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Typography alignSelf="center">Page {page}</Typography>
              <Button
                disabled={page * results.pageSize >= results.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </Stack>
          ) : null}
        </>
      ) : (
        <Alert severity="error">Results data did not load.</Alert>
      )}
    </>
  );
}
