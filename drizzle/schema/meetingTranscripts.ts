import {
  pgTable,
  varchar,
  jsonb,
  doublePrecision,
  bigint,
  boolean
} from 'drizzle-orm/pg-core';
import { leads } from './leads';

export const meetingTranscripts = pgTable('meeting_transcripts', {
  id: varchar('id', { length: 32 }).primaryKey(),
  title: varchar('title', { length: 255 }),
  speakers: jsonb('speakers'),
  transcriptUrl: varchar('transcript_url', { length: 512 }),
  participants: jsonb('participants'),
  meetingAttendees: jsonb('meeting_attendees'),
  duration: doublePrecision('duration'),
  date: bigint('date', { mode: 'number' }),
  dateString: varchar('date_string', { length: 32 }),
  summary: jsonb('summary'),
  meetingInfo: jsonb('meeting_info'),
  isArchived: boolean('is_archived').default(false),
  leadId: varchar('lead_id', { length: 32 }).references(() => leads.id, {
    onDelete: 'cascade'
  })
});

export type MeetingTranscript = typeof meetingTranscripts.$inferSelect;
export type NewMeetingTranscript = typeof meetingTranscripts.$inferInsert;
