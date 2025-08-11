const { pgTable, text, varchar, primaryKey } = require('drizzle-orm/pg-core');
const { leads } = require('./leads');

const leadSimilarUsers = pgTable(
  'lead_similar_users',
  {
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    mongoId: text('mongo_id').notNull(),
    reason: varchar('reason', { length: 255 }).notNull()
  },
  (table) => primaryKey({ columns: [table.leadId, table.mongoId] })
);

module.exports = { leadSimilarUsers };
