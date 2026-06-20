import {
  pgTable,
  serial,
  text,
  varchar,
  numeric,
  timestamp,
  pgEnum
} from 'drizzle-orm/pg-core';
import { leads } from './leads';
import { salesReps } from './salesReps';

// Notes/assumptions:
// - Using PostgreSQL types (Drizzle pg-core).
// - lead_id references leads.id (text), so this column is text and NOT NULL.
// - sales_user_id references sales_reps.user_id (varchar(64)).
// - deal_size_ntd uses numeric(12,2) to represent money with 2 decimals.
// - Timestamps default to now() (no ON UPDATE trigger applied in schema; app can update updated_at).

// Postgres enum for deal status
export const dealStatusEnum = pgEnum('deal_status', [
  'initiated',
  'sent',
  'signed',
  'closed',
  'canceled'
]);

export const deals = pgTable('deals', {
  id: serial('id').primaryKey(),
  leadId: text('lead_id')
    .notNull()
    .references(() => leads.id),
  salesUserId: varchar('sales_user_id', { length: 64 }).references(
    () => salesReps.userId,
    { onDelete: 'set null' }
  ),
  status: dealStatusEnum('status'),

  closedDate: timestamp('closed_date', { mode: 'string' }),
  initiatedAt: timestamp('initiated_at', { mode: 'string' }),
  sentAt: timestamp('sent_at', { mode: 'string' }),
  signedAt: timestamp('signed_at', { mode: 'string' }),
  closedAt: timestamp('closed_at', { mode: 'string' }),
  canceledAt: timestamp('canceled_at', { mode: 'string' }),

  dealSizeNtd: numeric('deal_size_ntd', { precision: 12, scale: 2 }),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

export type DealStatus = (typeof dealStatusEnum.enumValues)[number];
export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;
