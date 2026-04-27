const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const {
  GeneralGETRequestRateLimiter,
  GeneralPOSTRequestRateLimiter,
  GeneralDELETERequestRateLimiter
} = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');
const {
  archiveConversation,
  createConversation,
  getConversation,
  listConversations,
  listMyStudents,
  listRecentStudents,
  sendMessage,
  sendFirstMessage,
  updateConversation,
  searchStudents
} = require('../controllers/ai_assist');

const router = Router();

router.use(protect, permit(Role.Admin, Role.Agent, Role.Editor));

router
  .route('/conversations')
  .get(GeneralGETRequestRateLimiter, listConversations)
  .post(GeneralPOSTRequestRateLimiter, createConversation);

router
  .route('/students/recent')
  .get(GeneralGETRequestRateLimiter, listRecentStudents);

router.route('/students/mine').get(GeneralGETRequestRateLimiter, listMyStudents);

router
  .route('/students/search')
  .get(GeneralGETRequestRateLimiter, searchStudents);

router
  .route('/conversations/:conversationId/messages')
  .post(GeneralPOSTRequestRateLimiter, sendMessage);

router
  .route('/conversations/first-message')
  .post(GeneralPOSTRequestRateLimiter, sendFirstMessage);

router
  .route('/conversations/:conversationId')
  .get(GeneralGETRequestRateLimiter, getConversation)
  .patch(GeneralPOSTRequestRateLimiter, updateConversation)
  .delete(GeneralDELETERequestRateLimiter, archiveConversation);

module.exports = router;
