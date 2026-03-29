export const PLAN_MARKER_PREFIX = 'Plan marker: ';
export const PLAN_MARKER_VERSION = 1 as const;

export const PLAN_MARKER_KINDS = ['text-only', 'multimodal', 'blocked'] as const;
export type EvaluationPlanKind = (typeof PLAN_MARKER_KINDS)[number];

export interface PlanMarkerSource {
  kind: EvaluationPlanKind;
  forwardingRequested: boolean;
  supportedMedia?: readonly string[];
  blockedReason?: string | null;
}

export interface EvaluationPlanMarker extends PlanMarkerSource {
  version: typeof PLAN_MARKER_VERSION;
}

export function buildPlanMarker(source: PlanMarkerSource): string {
  const payload: Record<string, unknown> = {
    version: PLAN_MARKER_VERSION,
    kind: source.kind,
    forwardingRequested: source.forwardingRequested,
  };

  if (source.supportedMedia !== undefined) {
    payload.supportedMedia = source.supportedMedia;
  }

  if (source.blockedReason !== undefined && source.blockedReason !== null) {
    payload.blockedReason = source.blockedReason;
  } else if (source.blockedReason === null) {
    payload.blockedReason = null;
  }

  return `${PLAN_MARKER_PREFIX}${JSON.stringify(payload)}`;
}

function assertIsStringArray(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('Plan marker supportedMedia must be a string array.');
  }
}

export function parsePlanMarker(snapshot: string): EvaluationPlanMarker {
  const rawLines = snapshot.split('\n');
  const markerLine = rawLines
    .map((line) => line.trim())
    .find((line) => line.startsWith(PLAN_MARKER_PREFIX));

  if (!markerLine) {
    throw new Error('Missing plan marker line.');
  }

  const rawPayload = markerLine.slice(PLAN_MARKER_PREFIX.length).trim();
  if (!rawPayload) {
    throw new Error('Plan marker payload is empty.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload);
  } catch (error) {
    throw new Error(`Plan marker payload is not valid JSON (${error instanceof Error ? error.message : String(error)}).`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Plan marker payload must be an object.');
  }

  const payload = parsed as Record<string, unknown>;
  const version = payload.version;
  if (version !== PLAN_MARKER_VERSION) {
    throw new Error(`Unsupported plan marker version ${String(version)}.`);
  }

  const kind = payload.kind;
  if (typeof kind !== 'string' || !PLAN_MARKER_KINDS.includes(kind as EvaluationPlanKind)) {
    throw new Error(`Plan marker kind ${String(kind)} is invalid.`);
  }

  const forwardingRequested = payload.forwardingRequested;
  if (typeof forwardingRequested !== 'boolean') {
    throw new Error('Plan marker forwardingRequested must be a boolean.');
  }

  const supportedMedia = payload.supportedMedia;
  if (supportedMedia !== undefined) {
    assertIsStringArray(supportedMedia);
  }

  const blockedReason = payload.blockedReason;
  if (blockedReason !== undefined && blockedReason !== null && typeof blockedReason !== 'string') {
    throw new Error('Plan marker blockedReason must be a string if provided.');
  }

  return {
    version: PLAN_MARKER_VERSION,
    kind: kind as EvaluationPlanKind,
    forwardingRequested,
    supportedMedia: supportedMedia as string[] | undefined,
    blockedReason: blockedReason === undefined ? undefined : (blockedReason as string | null),
  };
}
