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
  getLeadByStudentId,
  createLeadFromStudent,
  updateLead,
  getMeetings,
  getMeeting,
  updateMeeting,
  getLeadTags,
  updateLeadTags,
  appendLeadTags,
  deleteLeadTags,
  getLeadNotes,
  createLeadNote,
  updateLeadNote,
  deleteLeadNote,
  replaceLeadNotes,
  getSalesReps,
  getDeals,
  createDeal,
  updateDeal,
  instantInviteMeetingAssistant
} = require('../controllers/crm');

const router = Router();

router.use(protect, permit(Role.Admin, Role.Agent, Role.Editor));

router
  .route('/leads/:leadId')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getLead)
  .put(filter_archiv_user, GeneralPUTRequestRateLimiter, updateLead);

router
  .route('/leads/:leadId/tags')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getLeadTags)
  .post(filter_archiv_user, GeneralPUTRequestRateLimiter, appendLeadTags)
  .put(filter_archiv_user, GeneralPUTRequestRateLimiter, updateLeadTags)
  .delete(filter_archiv_user, GeneralPUTRequestRateLimiter, deleteLeadTags);

router
  .route('/leads/:leadId/notes')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getLeadNotes)
  .post(filter_archiv_user, GeneralPUTRequestRateLimiter, createLeadNote)
  .put(filter_archiv_user, GeneralPUTRequestRateLimiter, replaceLeadNotes);

router
  .route('/leads/:leadId/notes/:noteId')
  .patch(filter_archiv_user, GeneralPUTRequestRateLimiter, updateLeadNote)
  .delete(filter_archiv_user, GeneralPUTRequestRateLimiter, deleteLeadNote);

router
  .route('/students/:studentId/lead')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getLeadByStudentId)
  .post(
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    createLeadFromStudent
  );

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

router
  .route('/instant-invite')
  .post(
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    instantInviteMeetingAssistant
  );

module.exports = router;
