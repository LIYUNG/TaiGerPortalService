const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const { getMessagesRateLimiter } = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');

const {
  getApplicationConflicts
} = require('../controllers/student_applications');

const { getApplicationDeltas } = require('../controllers/teams');

const router = Router();

router.use(protect);

router
  .route('/conflicts')
  .get(
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getApplicationConflicts
  );

router
  .route('/deltas')
  .get(
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getApplicationDeltas
  );

module.exports = router;
