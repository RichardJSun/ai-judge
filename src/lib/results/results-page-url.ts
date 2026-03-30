import type { VerdictEnum } from '@/types/db';

export type ResultsPageParamValue = string | string[] | undefined;
export type ResultsPageSearchParams = Record<string, ResultsPageParamValue>;

const VALID_VERDICTS: readonly VerdictEnum[] = ['pass', 'fail', 'inconclusive'];
const RESULTS_FILTER_PARAM_KEYS = ['page', 'judgeId', 'questionId', 'verdict'] as const;
const RESULTS_FILTER_PARAM_KEY_SET = new Set<string>(RESULTS_FILTER_PARAM_KEYS);

export interface ResultsPageUrlState {
  page: number;
  selectedJudges: string[];
  selectedQuestions: string[];
  selectedVerdicts: VerdictEnum[];
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

function hasOnlyWhitelistedResultsParams(searchParams: ResultsPageSearchParams) {
  return Object.entries(searchParams).every(
    ([key, value]) => value == null || RESULTS_FILTER_PARAM_KEY_SET.has(key)
  );
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

function appendResultsPageStateSearchParams(searchParams: URLSearchParams, state: ResultsPageUrlState) {
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
}

export function buildResultsQueryString(state: ResultsPageUrlState) {
  const searchParams = new URLSearchParams();
  appendResultsPageStateSearchParams(searchParams, state);
  return searchParams.toString();
}

export function buildSubmissionDetailResultsHref(
  queueId: string,
  submissionId: string,
  state: ResultsPageUrlState
) {
  const searchParams = new URLSearchParams();
  searchParams.set('source', 'results');
  appendResultsPageStateSearchParams(searchParams, state);
  return `/queues/${queueId}/submissions/${submissionId}?${searchParams.toString()}`;
}

export function buildResultsPageHref(pathname: string, state: ResultsPageUrlState) {
  const query = buildResultsQueryString(state);
  return query ? `${pathname}?${query}` : pathname;
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
  const onlyWhitelistedParams = hasOnlyWhitelistedResultsParams(searchParams);

  if (pageIsCanonical && judgesAreCanonical && questionsAreCanonical && verdictsAreCanonical && onlyWhitelistedParams) {
    return null;
  }

  return buildResultsPageHref(pathname, state);
}

export function getQueueResultsPath(queueId: string) {
  return `/queues/${queueId}/results`;
}

export function buildQueueResultsHref(queueId: string, searchParams: ResultsPageSearchParams) {
  return buildResultsPageHref(getQueueResultsPath(queueId), normalizeResultsPageSearchParams(searchParams));
}
