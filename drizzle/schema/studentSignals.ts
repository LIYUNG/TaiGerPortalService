import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

// One active communication risk signal, content-derived per student. `type` is
// a fixed category (controlled vocabulary); severity is validated to
// low|medium|high at write time but stored as a plain string. summaryEn/summaryZh
// hold the bilingual case description; firstSeenAt/lastSeenAt are server-owned.
export type StudentSignal = {
  type: string;
  severity: string;
  summaryEn: string;
  summaryZh: string;
  evidence: string;
  sourceMessageId: string | null;
  occurredAt: string | null;
  resolved: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  // Internal-only category harvest field; only meaningful when type === 'other'.
  suggestedType?: string;
};

// Accumulated, content-derived communication risk signals per student. Written
// incrementally by the AI Assist signal-ledger cron (only NEW messages since
// the last scan are analysed; prior signals are carried forward until the LLM
// marks them resolved). Read by the portfolio overview to surface IMPLICIT
// risks (frustration, broken promises, cooling engagement, ...) that the
// status/time-based buckets cannot see. One row per student.
export const studentCommunicationSignals = pgTable(
  'student_communication_signals',
  {
    // Mongo student ObjectId as string (matches ai_assist_conversations.student_id).
    studentId: text('student_id').primaryKey().notNull(),
    studentDisplayName: text('student_display_name'),
    // Highest unresolved severity across `signals`: none | low | medium | high.
    riskLevel: text('risk_level').notNull().default('none'),
    // Array of { type, severity, evidence, firstSeenAt, lastSeenAt, resolved }.
    signals: jsonb('signals')
      .$type<StudentSignal[]>()
      .notNull()
      .default([]),
    // Latest message timestamp seen at scan time (advances the incremental window).
    lastMessageAt: timestamp('last_message_at'),
    lastScannedAt: timestamp('last_scanned_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow()
  }
);

export type StudentCommunicationSignal =
  typeof studentCommunicationSignals.$inferSelect;
export type NewStudentCommunicationSignal =
  typeof studentCommunicationSignals.$inferInsert;
