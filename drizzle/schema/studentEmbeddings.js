const { pgTable, text, vector, timestamp } = require('drizzle-orm/pg-core');

const studentEmbeddings = pgTable('student_embeddings', {
  mongoId: text('mongo_id').primaryKey().notNull(),
  embedding: vector('embedding', { dimensions: 3072 }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  text: text(),
  fullName: text('full_name')
});

module.exports = { studentEmbeddings };
