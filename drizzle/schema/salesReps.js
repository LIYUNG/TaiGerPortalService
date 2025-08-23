const { pgTable, varchar, boolean } = require('drizzle-orm/pg-core');

const salesReps = pgTable('sales_reps', {
  userId: varchar('user_id', { length: 64 }).primaryKey(),
  label: varchar('label', { length: 255 }).notNull(),
  isActive: boolean('is_active').notNull().default(true)
});

module.exports = {
  salesReps
};
