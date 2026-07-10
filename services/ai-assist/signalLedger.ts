import { eq, inArray } from 'drizzle-orm';
import { Role } from '@taiger-common/core';

import { getPostgresDb } from '../../database';
import {
  studentCommunicationSignals,
  type StudentSignal,
  type StudentCommunicationSignal,
  type NewStudentCommunicationSignal
} from '../../drizzle/schema/schema';
import type { Response as OpenAIResponse } from 'openai/resources/responses/responses';
import { openAIClient, OpenAiModel } from '../openai';
import logger from '../logger';
import StudentService from '../students';
import CommunicationService from '../communications';
import tools from './tools';
// `normalizers` is exported via `export =` (CommonJS-style), so it must be
// imported as a default (esModuleInterop) rather than destructured as a named
// ES export.
import normalizers from './normalizers';

// Incremental "implicit risk" ledger. The portfolio overview's other buckets
// are status/time based and never read message TEXT, so content risks
// (frustration, broken promises, cooling engagement, ...) are invisible. This
// job reads each student's NEW messages since the last scan, runs ONE cheap LLM
// pass, and accumulates signals — old signals are carried forward (never
// re-reading old messages) until the model marks them resolved. Read-side
// (getSignalsForStudents) does zero LLM work.

const SIGNAL_MODEL = OpenAiModel.GPT_5_4_mini || 'gpt-5.4-mini';

// Cost guards.
const MAX_STUDENTS_PER_RUN = 150;
const MAX_ACTIVE_STUDENTS = 1500;
const MAX_MESSAGES_PER_SCAN = 40;
const MSG_TEXT_CAP = 600;

// Express request; kept loose to match the repo-wide ai-assist convention
// (see tools.ts's AiRequest) — it is only ever forwarded to
// tools.requireAccessibleStudent, which is itself typed this way.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AiRequest = any;

// Heterogeneous Mongoose lean/hydrated student document (populated reference
// unions / FlattenMaps subdocuments) whose runtime shape does not
// structurally match the strict @taiger-common/model interfaces; read
// defensively.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LeanStudent = Record<string, any>;

// One raw signal as returned by the LLM (validated/normalised by mergeSignals
// before being persisted) — every field is defensively optional since the
// model output is untrusted external JSON.
interface RawLlmSignal {
  type?: string;
  severity?: string;
  summaryEn?: string;
  summaryZh?: string;
  evidence?: string;
  msgIndex?: number;
  resolved?: boolean;
  suggestedType?: string;
  sourceMessageId?: string | null;
  occurredAt?: string | null;
}

// Fixed risk categories (controlled vocabulary) — drives the i18n display label
// on the card and lets the portfolio aggregate/filter by category. The specific
// per-case wording lives in the bilingual summary (shown on hover).
const SIGNAL_TYPES = Object.freeze([
  'frustration',
  'confusion',
  'repeated_unanswered_question',
  'broken_promise',
  'deadline_anxiety',
  'engagement_cooling',
  'mentions_competitor_or_refund',
  'sentiment_declining',
  'dissatisfaction_with_service',
  'urgent_unaddressed_request',
  'technical_access_issue',
  'missing_document_blocker',
  'financial_concern',
  'low_confidence_in_outcome',
  // Catch-all so real edge-case signals survive the type filter instead of being
  // dropped. Paired with `suggestedType` (free-text, internal-only) for harvesting
  // new categories from live data — query it periodically, promote frequent ones.
  'other'
]);

const SEVERITY_RANK: Record<string, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3
};
const SEVERITIES = Object.freeze(['low', 'medium', 'high']);

const INSTRUCTIONS =
  'You analyse the message history between a study-abroad student and the consultancy team (internal staff). ' +
  'Surface IMPLICIT risks that status/deadline metrics cannot show — tone, frustration, confusion, unanswered or repeated questions, ' +
  'vague/broken promises, deadline anxiety, cooling engagement (shorter/slower replies), mentions of competitors/refund/quitting, declining sentiment, dissatisfaction, ' +
  'technical/access blockers (login, portal, upload, links, system bugs), missing/blocked documents, financial concerns (fees, funding, budget), low confidence in their own outcome (self-doubt, eligibility/admission odds). ' +
  'You are given PRIOR signals already detected (older history you cannot re-read) and the NEW messages since the last scan. ' +
  'Return the UPDATED signal set: keep prior signals that are still relevant, set "resolved": true on any the new messages clearly address, and add new ones. ' +
  'Only report real, evidenced signals — never invent. Keep evidence to one short quote or paraphrase. ' +
  'Classify each signal under one fixed "type" category, AND write a SPECIFIC short description of the actual case (not the generic category) in BOTH English ("summaryEn") and Traditional Chinese ("summaryZh"), max ~12 words / ~20 characters, e.g. type "frustration" with "Frustrated about slow document feedback" / "對文件回覆緩慢感到不滿". ' +
  'Also set "msgIndex" to the "i" of the single message in the NEW messages list that best evidences the signal (omit or use 0 if it comes only from prior context). ' +
  `Allowed "type" values: ${SIGNAL_TYPES.join(
    ', '
  )}. Allowed "severity": ${SEVERITIES.join(', ')}. ` +
  'Use "other" ONLY when a real signal fits none of the listed categories; in that case set "suggestedType" to a snake_case category name you would propose for it. Leave "suggestedType" empty for any listed category. ' +
  'Return STRICT JSON only: {"signals":[{"type":"...","severity":"low|medium|high","summaryEn":"...","summaryZh":"...","evidence":"...","msgIndex":0,"resolved":false,"suggestedType":""}]}. ' +
  'If there are no signals, return {"signals":[]}.';

const safeParseJson = (value: unknown): unknown => {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(value.slice(start, end + 1));
    } catch {
      return null;
    }
  }
};

const toIdString = (value: unknown) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return (value as { toString?: () => string }).toString?.() || '';
};

// Highest unresolved severity across signals. Pure — unit tested.
const rollupRiskLevel = (signals: StudentSignal[] = []) => {
  let level = 'none';
  signals.forEach((signal) => {
    if (signal?.resolved) return;
    if ((SEVERITY_RANK[signal?.severity] || 0) > SEVERITY_RANK[level]) {
      level = signal.severity;
    }
  });
  return level;
};

// Validate + normalise the LLM output, then carry forward firstSeenAt from
// prior signals (matched by type) so server time — not the model — owns dates.
// `type` is a fixed category (i18n-displayed); summaryEn/summaryZh hold the
// specific bilingual description (shown on hover). Pure — unit tested.
const mergeSignals = (
  priorSignals: StudentSignal[] = [],
  llmSignals: RawLlmSignal[] = [],
  now = new Date()
): StudentSignal[] => {
  const nowIso = now.toISOString();
  // Prior record by type so server time + source refs survive incremental scans
  // that no longer include the original (old) message.
  const priorByType = new Map();
  (priorSignals || []).forEach((signal) => {
    if (signal?.type) priorByType.set(signal.type, signal);
  });

  // Normalise type/severity before validating — the model may return different
  // case ("Low") or spaced types ("broken promise"); dropping those silently
  // would leave a row with no signals despite real findings.
  const normType = (value: unknown) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
  const normSeverity = (value: unknown) =>
    String(value || '')
      .trim()
      .toLowerCase();
  const str = (value: unknown, cap: number) =>
    typeof value === 'string' ? value.trim().slice(0, cap) : '';

  return (Array.isArray(llmSignals) ? llmSignals : [])
    .map((signal) => ({
      type: normType(signal?.type),
      severity: normSeverity(signal?.severity),
      summaryEn: str(signal?.summaryEn, 120),
      summaryZh: str(signal?.summaryZh, 120),
      evidence: str(signal?.evidence, 400),
      // Internal-only harvest field; only meaningful when type === 'other'.
      suggestedType: normType(signal?.suggestedType).slice(0, 60),
      sourceMessageId: signal?.sourceMessageId || null,
      occurredAt: signal?.occurredAt || null,
      resolved: Boolean(signal?.resolved)
    }))
    .filter(
      (signal) =>
        SIGNAL_TYPES.includes(signal.type) &&
        SEVERITIES.includes(signal.severity)
    )
    .map((signal) => {
      const prior = priorByType.get(signal.type);
      return {
        ...signal,
        // Keep the original source/time when this scan did not re-reference it.
        sourceMessageId:
          signal.sourceMessageId || prior?.sourceMessageId || null,
        occurredAt: signal.occurredAt || prior?.occurredAt || null,
        suggestedType: signal.suggestedType || prior?.suggestedType || '',
        firstSeenAt: prior?.firstSeenAt || nowIso,
        lastSeenAt: nowIso
      };
    });
};

const extractOutputText = (
  response: OpenAIResponse | null | undefined
): string => {
  if (typeof response?.output_text === 'string' && response.output_text) {
    return response.output_text;
  }

  const parts = (response?.output || [])
    .flatMap((item) => ('content' in item ? item.content : []))
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (part?.type === 'output_text') {
        return part.text;
      }
      const partText = (part as { text?: unknown })?.text;
      if (typeof partText === 'string') {
        return partText;
      }
      return '';
    });

  return parts.filter(Boolean).join('\n');
};

const classifySignals = async ({
  priorSignals,
  messages
}: {
  priorSignals: StudentSignal[];
  messages: ReturnType<typeof buildScanMessages>;
}): Promise<RawLlmSignal[] | null> => {
  const response = await openAIClient.responses.create({
    model: SIGNAL_MODEL,
    instructions: INSTRUCTIONS,
    input: [
      {
        role: 'user',
        content: JSON.stringify(
          {
            priorSignals: (priorSignals || []).map((signal) => ({
              type: signal.type,
              severity: signal.severity,
              summaryEn: signal.summaryEn,
              summaryZh: signal.summaryZh,
              evidence: signal.evidence
            })),
            // 1-based index `i`; the id is kept server-side, not exposed.
            messages: (messages || []).map((message, index) => ({
              i: index + 1,
              from: message.from,
              at: message.at,
              text: message.text
            }))
          },
          null,
          2
        )
      }
    ]
  });

  const rawText = extractOutputText(response);
  const parsed = safeParseJson(rawText) as
    | RawLlmSignal[]
    | { signals?: RawLlmSignal[] }
    | null;
  // Accept either {"signals":[...]} or a bare top-level array.
  const signals: RawLlmSignal[] | null = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { signals?: RawLlmSignal[] } | null)?.signals)
    ? ((parsed as { signals?: RawLlmSignal[] }).signals as RawLlmSignal[])
    : parsed == null
    ? null
    : [];
  logger.info(
    `[AI Assist signal] LLM raw len=${(rawText || '').length} parsedSignals=${
      Array.isArray(signals) ? signals.length : 'null'
    } snippet=${JSON.stringify((rawText || '').slice(0, 200))}`
  );
  return signals;
};

// Build the compact message list (server-side, with id) — text-bearing only,
// capped count + length, oldest-first. The LLM gets a projection with a 1-based
// index instead of the id; the server maps the index back to id + timestamp.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buildScanMessages = (rawMessages: Record<string, any>[] = []) =>
  (rawMessages || [])
    .map((raw) => normalizers.normalizeMessage(raw))
    .filter((message) => message.text)
    .slice(-MAX_MESSAGES_PER_SCAN)
    .map((message) => ({
      id: message.id || null,
      from: message.author?.role === Role.Student ? 'student' : 'team',
      at: message.createdAt ? new Date(message.createdAt).toISOString() : null,
      text: String(message.text).slice(0, MSG_TEXT_CAP)
    }));

// Resolve each LLM signal's msgIndex (1-based, into the scanned batch) back to
// the real source message id + timestamp. Out-of-range / missing → null.
const withSourceRefs = (
  llmSignals: RawLlmSignal[] | null | undefined,
  scanMessages: ReturnType<typeof buildScanMessages>
): RawLlmSignal[] =>
  (Array.isArray(llmSignals) ? llmSignals : []).map((signal) => {
    const idx = Number(signal?.msgIndex);
    const src =
      Number.isInteger(idx) && idx >= 1 && idx <= scanMessages.length
        ? scanMessages[idx - 1]
        : null;
    return {
      ...signal,
      sourceMessageId: src?.id || null,
      occurredAt: src?.at || null
    };
  });

// Scan one student: read messages, classify, return the merged signal row (or
// null if there was nothing to look at).
// - Incremental (prior scan exists): only messages since the last scan.
// - Cold start (first scan): the latest MAX_MESSAGES_PER_SCAN messages with NO
//   date floor, so a student who has not been contacted in months still gets
//   scanned over their most recent history instead of coming back empty.
const scanStudent = async (
  student: any,
  priorRow: StudentCommunicationSignal | null | undefined
) => {
  const studentId = toIdString(student._id || student.id);
  const isColdStart = !priorRow?.lastScannedAt;
  const filter: Record<string, unknown> = { student_id: studentId };
  if (priorRow?.lastScannedAt) {
    filter.createdAt = { $gt: new Date(priorRow.lastScannedAt) };
  }

  const rawMessages = await CommunicationService.findPopulatedSorted(filter, {
    limit: MAX_MESSAGES_PER_SCAN
  });
  logger.info(
    `[AI Assist signal] ${studentId}: ${
      rawMessages?.length || 0
    } raw messages (cold=${isColdStart}, latest ${MAX_MESSAGES_PER_SCAN})`
  );
  if (!rawMessages?.length) return null;

  const messages = buildScanMessages(rawMessages.slice().reverse());
  if (!messages.length) {
    logger.info(`[AI Assist signal] ${studentId}: no text-bearing messages`);
    return null;
  }

  const llmSignals = await classifySignals({
    priorSignals: priorRow?.signals || [],
    messages
  });
  if (llmSignals == null) {
    logger.warn(
      `[AI Assist signal] ${studentId}: LLM returned no parseable signals (model=${SIGNAL_MODEL})`
    );
    return null;
  }

  const now = new Date();
  const signals = mergeSignals(
    priorRow?.signals || [],
    withSourceRefs(llmSignals, messages),
    now
  );
  const lastMessageAt = messages.reduce<Date | null>((latest, message) => {
    const at = message.at ? new Date(message.at) : null;
    return at && (!latest || at > latest) ? at : latest;
  }, null);

  const displayName =
    normalizers.normalizeUser(student)?.name ||
    priorRow?.studentDisplayName ||
    null;

  return {
    studentId,
    studentDisplayName: displayName,
    riskLevel: rollupRiskLevel(signals),
    signals,
    lastMessageAt: lastMessageAt || priorRow?.lastMessageAt || null,
    lastScannedAt: now,
    updatedAt: now
  };
};

const loadPriorRow = async (
  postgres: any,
  studentId: string
): Promise<StudentCommunicationSignal | null> => {
  const rows = await postgres
    .select()
    .from(studentCommunicationSignals)
    .where(eq(studentCommunicationSignals.studentId, studentId))
    .limit(1);
  return rows[0] || null;
};

const upsertSignalRow = (postgres: any, row: NewStudentCommunicationSignal) =>
  postgres
    .insert(studentCommunicationSignals)
    .values(row)
    .onConflictDoUpdate({
      target: studentCommunicationSignals.studentId,
      set: {
        studentDisplayName: row.studentDisplayName,
        riskLevel: row.riskLevel,
        signals: row.signals,
        lastMessageAt: row.lastMessageAt,
        lastScannedAt: row.lastScannedAt,
        updatedAt: row.updatedAt
      }
    });

// ---- Per-student entry (on-demand, e.g. student deep-dive) ------------------

// Scan ONE student's new messages and update their ledger row. Access-scoped
// via requireAccessibleStudent (user-triggered). Incremental by construction:
// first call cold-starts (last COLD_START_DAYS), later calls read only messages
// since the previous scan. Returns the updated row (or the prior row when there
// was nothing new). This is the same per-student unit the bulk cron
// (scanCommunicationSignals) runs over — kept separate so a cron can be split
// out later without touching this path.
const scanStudentSignals = async (
  req: AiRequest,
  studentId: string | undefined
) => {
  const student = (await tools.requireAccessibleStudent(
    req,
    studentId
  )) as LeanStudent;
  const postgres = getPostgresDb();
  const id = toIdString(student._id || student.id);
  const prior = await loadPriorRow(postgres, id);

  logger.info(
    `[AI Assist signal] scanStudentSignals start: student=${id} hasPriorRow=${Boolean(
      prior
    )}`
  );
  const row = await scanStudent(student, prior);
  if (!row) {
    logger.info(`[AI Assist signal] ${id}: no row written (nothing to scan)`);
    return prior; // nothing new since last scan
  }
  await upsertSignalRow(postgres, row);
  logger.info(
    `[AI Assist signal] ${id}: upserted, riskLevel=${row.riskLevel}, signals=${row.signals.length}`
  );
  return row;
};

const hasUnresolvedSignals = (row: StudentCommunicationSignal | null) =>
  Boolean(row?.signals?.some?.((signal) => !signal.resolved));

// Single read for the per-student overview tool. Null when nothing to show.
// Gated on having ≥1 unresolved signal (not on riskLevel) so a row is shown
// whenever there is actual content, independent of the rollup.
const getStudentSignalRow = async (
  studentId: string | undefined
): Promise<StudentCommunicationSignal | null> => {
  const postgres = getPostgresDb();
  const row = await loadPriorRow(postgres, toIdString(studentId));
  return hasUnresolvedSignals(row) ? row : null;
};

// ---- Cron entry -------------------------------------------------------------

// Bulk cron orchestration (candidate selection, chunked fan-out, error
// swallowing). Excluded from coverage: it is a thin scheduler over scanStudent
// (which the per-student path exercises) and would need a heavy DB/aggregation
// mock for little signal. Opt-in and rarely run.
/* istanbul ignore next -- cron orchestration over the tested scanStudent unit */
const scanCommunicationSignals = async () => {
  const postgres = getPostgresDb();
  const startedAt = Date.now();

  const students = (await StudentService.findStudentsSelect(
    { role: Role.Student, archiv: { $ne: true } },
    'firstname lastname firstname_chinese lastname_chinese role',
    MAX_ACTIVE_STUDENTS
  )) as LeanStudent[];
  if (!students.length) return { scanned: 0, flagged: 0 };

  const studentObjectIds = students.map((s) => s._id || s.id).filter(Boolean);
  const studentIds = studentObjectIds.map(toIdString);

  // Latest message time per student (one aggregation) — used to skip students
  // with no new activity since their last scan.
  const latestById = new Map<string, Date>();
  const latestRows = await CommunicationService.getLatestMessageAtForStudents(
    studentObjectIds
  );
  (latestRows || []).forEach((rowItem: any) => {
    const id = toIdString(rowItem._id ?? rowItem.studentId);
    const at = rowItem.latestAt ? new Date(rowItem.latestAt) : null;
    if (id && at && !Number.isNaN(at.getTime())) latestById.set(id, at);
  });

  // Existing ledger rows for these students.
  const priorRows = await postgres
    .select()
    .from(studentCommunicationSignals)
    .where(inArray(studentCommunicationSignals.studentId, studentIds));
  const priorById = new Map<string, StudentCommunicationSignal>(
    priorRows.map((r: StudentCommunicationSignal) => [r.studentId, r])
  );

  // Candidates: have messages AND (never scanned OR new messages since scan).
  const candidates = students
    .map((student) => {
      const id = toIdString(student._id || student.id);
      return { student, id, latestAt: latestById.get(id) || null };
    })
    .filter(({ id, latestAt }) => {
      if (!latestAt) return false;
      const lastScannedAt = priorById.get(id)?.lastScannedAt;
      return !lastScannedAt || latestAt > new Date(lastScannedAt);
    })
    .sort(
      (a, b) => (b.latestAt as Date).getTime() - (a.latestAt as Date).getTime()
    )
    .slice(0, MAX_STUDENTS_PER_RUN);

  let scanned = 0;
  let flagged = 0;

  // Small concurrency to bound LLM load.
  const CHUNK = 5;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      chunk.map(async ({ student, id }) => {
        try {
          const row = await scanStudent(student, priorById.get(id));
          if (!row) return;
          await upsertSignalRow(postgres, row);
          scanned += 1;
          if (row.riskLevel !== 'none') flagged += 1;
        } catch (error) {
          logger.warn(
            `[AI Assist] signal scan skipped for ${id}: ${
              error instanceof Error ? error.message : 'unknown error'
            }`
          );
        }
      })
    );
  }

  const durationMs = Date.now() - startedAt;
  logger.info(
    `[AI Assist] communication signal scan done: ${scanned} scanned, ${flagged} flagged (${durationMs}ms)`
  );
  return { scanned, flagged };
};

// ---- Read side (for overview) ----------------------------------------------

// Returns rows with ≥1 unresolved signal for the given students, keyed by id.
const getSignalsForStudents = async (studentIds: string[]) => {
  const ids = (studentIds || []).map(toIdString).filter(Boolean);
  if (!ids.length) return new Map<string, StudentCommunicationSignal>();

  const postgres = getPostgresDb();
  const rows = await postgres
    .select()
    .from(studentCommunicationSignals)
    .where(inArray(studentCommunicationSignals.studentId, ids));

  const byId = new Map<string, StudentCommunicationSignal>();
  rows.forEach((row) => {
    if (hasUnresolvedSignals(row)) byId.set(row.studentId, row);
  });
  return byId;
};

export = {
  scanCommunicationSignals,
  scanStudentSignals,
  getStudentSignalRow,
  getSignalsForStudents,
  // exported for unit tests
  mergeSignals,
  rollupRiskLevel,
  withSourceRefs,
  buildScanMessages,
  safeParseJson,
  extractOutputText,
  SIGNAL_TYPES
};
