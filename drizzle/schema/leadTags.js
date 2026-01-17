const {
  pgTable,
  text,
  varchar,
  timestamp,
  uniqueIndex
} = require('drizzle-orm/pg-core');
const { nanoid } = require('nanoid');
const { leads } = require('./leads');

const leadTags = pgTable(
  'lead_tags',
  {
    id: text('id')
      .primaryKey()
      .notNull()
      .$defaultFn(() => nanoid()),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
    createdBy: varchar('created_by', { length: 64 }),
    createdAt: timestamp('created_at').defaultNow()
  },
  (table) => ({
    leadTagUnique: uniqueIndex('lead_tags_lead_id_tag_unique').on(
      table.leadId,
      table.tag
    )
  })
);

module.exports = { leadTags };
