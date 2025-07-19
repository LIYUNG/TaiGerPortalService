const {
  pgTable,
  varchar,
  jsonb,
  doublePrecision,
  bigint,
  text,
  timestamp
} = require('drizzle-orm/pg-core');

// Use a dynamic import for nanoid
const createId = () => import('nanoid').then((mod) => mod.nanoid());

const leads = pgTable('leads', {
  id: text('id').primaryKey().$default(createId).notNull(),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  gender: varchar('gender', { length: 10 }),

  preferredContact: varchar('preferred_contact', { length: 50 }),
  email: varchar('email', { length: 255 }),
  lineId: varchar('line_id', { length: 100 }),
  skypeId: varchar('skype_id', { length: 100 }),
  phone: varchar('phone', { length: 50 }),

  source: varchar('source', { length: 100 }),
  status: varchar('status', { length: 50 }).default('new'),
  tags: text('tags'),

  notes: text('notes'),
  userId: varchar('user_id', { length: 32 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

const meetingTranscripts = pgTable('meeting_transcripts', {
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
  leadId: varchar('lead_id', { length: 32 })
});

module.exports = { leads, meetingTranscripts };
