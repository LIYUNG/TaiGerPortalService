const { pgTable, text, varchar, timestamp } = require('drizzle-orm/pg-core');
const { nanoid } = require('nanoid');
const { leads } = require('./leads');

const leadNotes = pgTable('lead_notes', {
  id: text('id')
    .primaryKey()
    .notNull()
    .$defaultFn(() => nanoid()),
  leadId: text('lead_id')
    .notNull()
    .references(() => leads.id, { onDelete: 'cascade' }),
  note: text('note').notNull(),
  createdBy: varchar('created_by', { length: 64 }),
  createdAt: timestamp('created_at').defaultNow()
});

module.exports = { leadNotes };
