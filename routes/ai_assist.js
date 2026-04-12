const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const {
  GeneralGETRequestRateLimiter,
  GeneralPOSTRequestRateLimiter
} = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');
const {
  createConversation,
  getConversation,
  listConversations,
  sendMessage
} = require('../controllers/ai_assist');

const router = Router();

router.use(protect, permit(Role.Admin, Role.Agent, Role.Editor));

router
  .route('/conversations')
  .get(GeneralGETRequestRateLimiter, listConversations)
  .post(GeneralPOSTRequestRateLimiter, createConversation);

router
  .route('/conversations/:conversationId/messages')
  .post(GeneralPOSTRequestRateLimiter, sendMessage);

router
  .route('/conversations/:conversationId')
  .get(GeneralGETRequestRateLimiter, getConversation);

module.exports = router;
