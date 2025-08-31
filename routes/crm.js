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
  updateLead,
  getMeetings,
  getMeeting,
  updateMeeting,
  getSalesReps,
  getDeals,
  createDeal,
  updateDeal
} = require('../controllers/crm');
const { fi } = require('@faker-js/faker');

const router = Router();

router.use(protect, permit(Role.Admin, Role.Agent, Role.Editor));

router
  .route('/leads/:leadId')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getLead)
  .put(filter_archiv_user, GeneralPUTRequestRateLimiter, updateLead);

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

router
  .route('/sales-reps')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getSalesReps);

router
  .route('/deals/:dealId')
  .put(filter_archiv_user, GeneralPUTRequestRateLimiter, updateDeal);

router
  .route('/deals')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getDeals)
  .post(filter_archiv_user, GeneralPUTRequestRateLimiter, createDeal);

module.exports = router;
