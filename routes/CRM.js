const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const { GeneralGETRequestRateLimiter } = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');

const { getMeetingSummaries } = require('../controllers/CRM');

const router = Router();

router.use(protect, permit(Role.Admin, Role.Agent, Role.Editor));

router
  .route('/meeting-summaries')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getMeetingSummaries);

module.exports = router;
