const {
  pgTable,
  serial,
  text,
  varchar,
  date,
  numeric,
  timestamp
} = require('drizzle-orm/pg-core');
const { leads } = require('./leads');
const { salesReps } = require('./salesReps');

// Notes/assumptions:
// - Using PostgreSQL types (Drizzle pg-core).
// - lead_id references leads.id (text), so this column is text and NOT NULL.
// - sales_user_id references sales_reps.user_id (varchar(64)).
// - deal_size_ntd uses numeric(12,2) to represent money with 2 decimals.
// - Timestamps default to now() (no ON UPDATE trigger applied in schema; app can update updated_at).

const deals = pgTable('deals', {
  id: serial('id').primaryKey(),
  leadId: text('lead_id')
    .notNull()
    .references(() => leads.id),
  salesUserId: varchar('sales_user_id', { length: 64 }).references(
    () => salesReps.userId,
    { onDelete: 'set null' }
  ),
  status: varchar('status', {
    length: 50,
    enum: ['initiated', 'sent', 'signed', 'closed', 'canceled']
  }),

  // Status timestamps - automatically set when status changes
  initiatedAt: timestamp('initiated_at'),
  sentAt: timestamp('sent_at'),
  signedAt: timestamp('signed_at'),
  closedAt: timestamp('closed_at'),
  canceledAt: timestamp('canceled_at'),

  dealSizeNtd: numeric('deal_size_ntd', { precision: 12, scale: 2 }),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

module.exports = { deals };
