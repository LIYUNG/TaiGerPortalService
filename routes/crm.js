const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const {
  GeneralGETRequestRateLimiter,
  GeneralPUTRequestRateLimiter
} = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');

const {
  getCRMStats,
  getLeads,
  getLead,
  getMeetings,
  getMeeting,
  updateMeeting
} = require('../controllers/crm');

const router = Router();

router.use(protect, permit(Role.Admin, Role.Agent, Role.Editor));

router
  .route('/leads/:leadId')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getLead);

router
  .route('/leads')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getLeads);

router
  .route('/meetings/:meetingId')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getMeeting)
  .put(filter_archiv_user, GeneralPUTRequestRateLimiter, updateMeeting);

router
  .route('/meetings')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getMeetings);

router
  .route('/stats')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getCRMStats);

module.exports = router;
