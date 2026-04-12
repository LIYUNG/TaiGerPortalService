const { asc, desc, eq, and } = require('drizzle-orm');
const { ErrorResponse } = require('../common/errors');
const { getPostgresDb } = require('../database');
const { asyncHandler } = require('../middlewares/error-handler');
const {
  aiAssistConversations,
  aiAssistMessages,
  aiAssistToolCalls
} = require('../drizzle/schema/schema');
const { runAiAssist } = require('../services/ai-assist/orchestrator');
const { withPostgresRetry } = require('../services/ai-assist/postgresRetry');

const DEFAULT_TITLE = 'New AI Assist conversation';

const currentUserId = (req) => req.user?._id?.toString();

const requireConversationOwner = async (postgres, conversationId, userId) => {
  const rows = await postgres
    .select()
    .from(aiAssistConversations)
    .where(
      and(
        eq(aiAssistConversations.id, conversationId),
        eq(aiAssistConversations.ownerUserId, userId)
      )
    )
    .limit(1);

  if (!rows.length) {
    throw new ErrorResponse(404, 'AI Assist conversation not found');
  }

  return rows[0];
};

const createConversation = asyncHandler(async (req, res) => {
  const postgres = getPostgresDb();
  const ownerUserId = currentUserId(req);
  const [conversation] = await withPostgresRetry(
    () =>
      postgres
        .insert(aiAssistConversations)
        .values({
          ownerUserId,
          ownerRole: req.user.role,
          title: req.body?.title || DEFAULT_TITLE,
          status: 'active'
        })
        .returning(),
    {
      operation: 'ai_assist_create_conversation',
      ownerUserId
    }
  );

  res.status(201).send({
    success: true,
    data: conversation
  });
});

const listConversations = asyncHandler(async (req, res) => {
  const postgres = getPostgresDb();
  const conversations = await postgres
    .select()
    .from(aiAssistConversations)
    .where(eq(aiAssistConversations.ownerUserId, currentUserId(req)))
    .orderBy(desc(aiAssistConversations.updatedAt))
    .limit(25);

  res.status(200).send({
    success: true,
    data: conversations
  });
});

const getConversation = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const postgres = getPostgresDb();
  const conversation = await requireConversationOwner(
    postgres,
    conversationId,
    currentUserId(req)
  );
  const messages = await postgres
    .select()
    .from(aiAssistMessages)
    .where(eq(aiAssistMessages.conversationId, conversationId))
    .orderBy(asc(aiAssistMessages.createdAt));
  const trace = await postgres
    .select()
    .from(aiAssistToolCalls)
    .where(eq(aiAssistToolCalls.conversationId, conversationId))
    .orderBy(asc(aiAssistToolCalls.createdAt));

  res.status(200).send({
    success: true,
    data: {
      conversation,
      messages,
      trace
    }
  });
});

const updateConversation = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const title = req.body?.title?.trim();

  if (!title) {
    throw new ErrorResponse(400, 'Conversation title is required');
  }

  const postgres = getPostgresDb();
  await requireConversationOwner(postgres, conversationId, currentUserId(req));

  const [conversation] = await postgres
    .update(aiAssistConversations)
    .set({ title, updatedAt: new Date() })
    .where(eq(aiAssistConversations.id, conversationId))
    .returning();

  res.status(200).send({
    success: true,
    data: conversation
  });
});

const sendMessage = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    throw new ErrorResponse(400, 'message is required');
  }

  const postgres = getPostgresDb();
  await requireConversationOwner(postgres, conversationId, currentUserId(req));

  const result = await runAiAssist(postgres, {
    conversationId,
    message,
    req
  });
  await postgres
    .update(aiAssistConversations)
    .set({ updatedAt: new Date() })
    .where(eq(aiAssistConversations.id, conversationId));

  res.status(200).send({
    success: true,
    data: result
  });
});

module.exports = {
  createConversation,
  getConversation,
  listConversations,
  sendMessage,
  updateConversation
};
