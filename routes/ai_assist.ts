import { Router } from 'express';
import { Role } from '@taiger-common/core';

import {
  GeneralGETRequestRateLimiter,
  GeneralPOSTRequestRateLimiter,
  GeneralDELETERequestRateLimiter
} from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';
import {
  archiveConversation,
  createConversation,
  getConversation,
  getLatestStudentAnalysis,
  getOverview,
  listConversations,
  listMyStudents,
  listRecentStudents,
  sendMessage,
  sendFirstMessage,
  updateConversation,
  searchStudents
} from '../controllers/ai_assist';
import cvDraftController from '../controllers/cv_draft';

const router = Router();

router.use(
  GeneralGETRequestRateLimiter,
  protect,
  permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor)
);

router
  .route('/conversations')
  .get(GeneralGETRequestRateLimiter, listConversations)
  .post(GeneralPOSTRequestRateLimiter, createConversation);

router.route('/overview').get(GeneralGETRequestRateLimiter, getOverview);

router
  .route('/students/recent')
  .get(GeneralGETRequestRateLimiter, listRecentStudents);

router
  .route('/students/mine')
  .get(GeneralGETRequestRateLimiter, listMyStudents);

router
  .route('/students/search')
  .get(GeneralGETRequestRateLimiter, searchStudents);

router
  .route('/students/:studentId/latest-analysis')
  .get(GeneralGETRequestRateLimiter, getLatestStudentAnalysis);

router
  .route('/students/:studentId/cv-draft')
  .post(GeneralPOSTRequestRateLimiter, cvDraftController.generateCvDraft);

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

export = router;
