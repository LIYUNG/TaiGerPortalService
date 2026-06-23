import { pgTable, varchar, boolean } from 'drizzle-orm/pg-core';

export const salesReps = pgTable('sales_reps', {
  userId: varchar('user_id', { length: 64 }).primaryKey(),
  label: varchar('label', { length: 255 }).notNull(),
  isActive: boolean('is_active').notNull().default(true)
});

export type SalesRep = typeof salesReps.$inferSelect;
export type NewSalesRep = typeof salesReps.$inferInsert;
