const {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  numeric,
  date
} = require('drizzle-orm/pg-core');
const { nanoid } = require('nanoid');

const aiAssistConversations = pgTable('ai_assist_conversations', {
  id: text('id')
    .primaryKey()
    .notNull()
    .$defaultFn(() => nanoid()),
  ownerUserId: text('owner_user_id').notNull(),
  ownerRole: text('owner_role').notNull(),
  title: text('title').notNull().default('New AI Assist conversation'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

const aiAssistMessages = pgTable('ai_assist_messages', {
  id: text('id')
    .primaryKey()
    .notNull()
    .$defaultFn(() => nanoid()),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => aiAssistConversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  model: text('model'),
  responseId: text('response_id'),
  usage: jsonb('usage'),
  createdAt: timestamp('created_at').defaultNow()
});

const aiAssistToolCalls = pgTable('ai_assist_tool_calls', {
  id: text('id')
    .primaryKey()
    .notNull()
    .$defaultFn(() => nanoid()),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => aiAssistConversations.id, { onDelete: 'cascade' }),
  assistantMessageId: text('assistant_message_id').references(
    () => aiAssistMessages.id,
    { onDelete: 'cascade' }
  ),
  toolName: text('tool_name').notNull(),
  arguments: jsonb('arguments'),
  result: jsonb('result'),
  status: text('status').notNull(),
  durationMs: integer('duration_ms'),
  permissionOutcome: jsonb('permission_outcome'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow()
});

const aiAssistUsage = pgTable('ai_assist_usage', {
  id: text('id')
    .primaryKey()
    .notNull()
    .$defaultFn(() => nanoid()),
  userId: text('user_id').notNull(),
  model: text('model').notNull(),
  date: date('date').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  toolCallCount: integer('tool_call_count').notNull().default(0),
  estimatedCost: numeric('estimated_cost', { precision: 12, scale: 6 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

module.exports = {
  aiAssistConversations,
  aiAssistMessages,
  aiAssistToolCalls,
  aiAssistUsage
};
