import { pgTable, text, varchar, timestamp } from 'drizzle-orm/pg-core';
import { nanoid } from 'nanoid';
import { leads } from './leads';

export const leadNotes = pgTable('lead_notes', {
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

export type LeadNote = typeof leadNotes.$inferSelect;
export type NewLeadNote = typeof leadNotes.$inferInsert;
