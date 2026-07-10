import { Router } from 'express';
import { Role } from '@taiger-common/core';

import {
  GeneralGETRequestRateLimiter,
  GeneralPOSTRequestRateLimiter,
  GeneralDELETERequestRateLimiter
} from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';
import {
  permission_canUseTaiGerAI_filter,
  permission_TaiGerAIRatelimiter
} from '../middlewares/permission-filter';
import aiAssistController from '../controllers/ai_assist';
import cvDraftController from '../controllers/cv_draft';

const {
  archiveConversation,
  createConversation,
  generateReplyDraft,
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
} = aiAssistController;

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

// Reply-draft makes a full agentic LLM call, so it is gated by the TaiGer AI
// permission + rate limiter (same surface as the legacy chat assistant it
// replaces) and consumes the user's TaiGer AI quota.
router
  .route('/students/:studentId/reply-draft')
  .post(
    GeneralPOSTRequestRateLimiter,
    permission_canUseTaiGerAI_filter,
    permission_TaiGerAIRatelimiter,
    generateReplyDraft
  );

// CV-draft generation makes an LLM call and consumes the user's TaiGer AI quota,
// so it is gated by the same permission + rate limiter as reply-draft. (render,
// download and attach are deterministic/no-LLM and stay ungated.)
router
  .route('/students/:studentId/cv-draft')
  .post(
    GeneralPOSTRequestRateLimiter,
    permission_canUseTaiGerAI_filter,
    permission_TaiGerAIRatelimiter,
    cvDraftController.generateCvDraft
  );

router
  .route('/ai-quota')
  .get(GeneralGETRequestRateLimiter, cvDraftController.getMyAiQuota);

router
  .route('/students/:studentId/cv-draft/readiness')
  .get(GeneralGETRequestRateLimiter, cvDraftController.getCvReadiness);

router
  .route('/students/:studentId/cv-draft/validate')
  .post(GeneralPOSTRequestRateLimiter, cvDraftController.validateCvDraft);

router
  .route('/students/:studentId/cv-draft/render')
  .post(GeneralPOSTRequestRateLimiter, cvDraftController.renderCvDraft);

router
  .route('/students/:studentId/cv-draft/render/download')
  .post(GeneralPOSTRequestRateLimiter, cvDraftController.downloadCvDraft);

router
  .route('/threads/:documentsthreadId/cv-draft')
  .get(GeneralGETRequestRateLimiter, cvDraftController.getSavedCvDraft)
  .put(GeneralPOSTRequestRateLimiter, cvDraftController.updateCvDraft);

router
  .route('/threads/:documentsthreadId/cv-draft/attach')
  .post(GeneralPOSTRequestRateLimiter, cvDraftController.attachCvDraftToThread);

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
