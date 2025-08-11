const { pgTable, text, varchar } = require('drizzle-orm/pg-core');
const { leads } = require('./leads');

const leadSimilarUsers = pgTable('lead_similar_users', {
  leadId: text('lead_id')
    .notNull()
    .references(() => leads.id, { onDelete: 'cascade' }),
  mongoId: text('mongo_id').notNull(),
  reason: varchar('reason', { length: 255 }).notNull()
});

module.exports = { leadSimilarUsers };
