const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const {
  GeneralPOSTRequestRateLimiter
} = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');
const { chatbotMessage } = require('../controllers/chatbot');

const router = Router();

router.use(protect);

router
  .route('/message')
  .post(
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    chatbotMessage
  );

module.exports = router;
