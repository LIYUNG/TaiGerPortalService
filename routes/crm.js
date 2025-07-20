const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const { GeneralGETRequestRateLimiter } = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');

const {
  getCRMStats,
  getLeads,
  getMeetingSummaries
} = require('../controllers/crm');

const router = Router();

router.use(protect, permit(Role.Admin, Role.Agent, Role.Editor));

router
  .route('/leads')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getLeads);

router
  .route('/meeting-summaries')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getMeetingSummaries);

router
  .route('/stats')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getCRMStats);

module.exports = router;
