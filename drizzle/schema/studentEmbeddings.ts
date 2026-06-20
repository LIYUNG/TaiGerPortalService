import { pgTable, text, vector, timestamp } from 'drizzle-orm/pg-core';

export const studentEmbeddings = pgTable('student_embeddings', {
  mongoId: text('mongo_id').primaryKey().notNull(),
  embedding: vector('embedding', { dimensions: 3072 }),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  text: text(),
  fullName: text('full_name')
});

export type StudentEmbedding = typeof studentEmbeddings.$inferSelect;
export type NewStudentEmbedding = typeof studentEmbeddings.$inferInsert;
