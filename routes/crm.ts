import { Router } from 'express';
import { Role } from '@taiger-common/core';

import {
  GeneralGETRequestRateLimiter,
  GeneralPUTRequestRateLimiter
} from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';

import {
  getCRMStats,
  getLeads,
  getLead,
  getLeadByStudentId,
  createLeadFromStudent,
  updateLead,
  getMeetings,
  getMeeting,
  updateMeeting,
  appendLeadTags,
  deleteLeadTags,
  createLeadNote,
  updateLeadNote,
  deleteLeadNote,
  getSalesReps,
  getDeals,
  createDeal,
  updateDeal,
  instantInviteMeetingAssistant
} from '../controllers/crm';

const router = Router();

router.use(protect, permit(Role.Admin, Role.Agent, Role.Editor));

router
  .route('/leads/:leadId')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getLead)
  .put(filter_archiv_user, GeneralPUTRequestRateLimiter, updateLead);

router
  .route('/leads/:leadId/tags')
  .post(filter_archiv_user, GeneralPUTRequestRateLimiter, appendLeadTags)
  .delete(filter_archiv_user, GeneralPUTRequestRateLimiter, deleteLeadTags);

router
  .route('/leads/:leadId/notes')
  .post(filter_archiv_user, GeneralPUTRequestRateLimiter, createLeadNote);

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

export = router;
