const {
  pgTable,
  varchar,
  jsonb,
  doublePrecision,
  bigint,
  uuid,
  text,
  timestamp
} = require('drizzle-orm/pg-core');

const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  firstName: varchar('first_name', { length: 255 }),
  lastName: varchar('last_name', { length: 255 }),
  firstNameChinese: varchar('first_name_chinese', { length: 255 }),
  lastNameChinese: varchar('last_name_chinese', { length: 255 }),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  lineId: varchar('line_id', { length: 100 }),

  education: text('education'),
  degree: varchar('degree', { length: 100 }),

  countryInterest: varchar('country_interest', { length: 255 }),
  programInterest: varchar('program_interest', { length: 255 }),

  status: varchar('status', { length: 50 }).default('new'), // e.g. new, contacted, etc.
  source: varchar('source', { length: 100 }),

  tags: text('tags'), // comma-separated or JSON later
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

const transcripts = pgTable('transcripts', {
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
  meetingInfo: jsonb('meeting_info')
});

module.exports = { leads, transcripts };
