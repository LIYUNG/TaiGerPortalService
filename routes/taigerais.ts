import { Router } from 'express';
import { Role } from '@taiger-common/core';

import { GeneralGETRequestRateLimiter } from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';
import { processProgramListAi, cvmlrlAi } from '../controllers/taigerais';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';
import {
  permission_canModifyProgramList_filter,
  permission_canUseTaiGerAI_filter,
  permission_TaiGerAIRatelimiter
} from '../middlewares/permission-filter';

const router = Router();
router.use(protect);

// NOTE: POST /chat/:studentId (the legacy chat assistant) is retired. The chat
// composer now uses POST /api/ai-assist/students/:studentId/reply-draft, which
// drafts a context-grounded reply for the agent to review before sending.

router
  .route('/cvmlrl')
  .post(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    permission_canUseTaiGerAI_filter,
    permission_TaiGerAIRatelimiter,
    cvmlrlAi
  );

router
  .route('/program/:programId')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    permission_canModifyProgramList_filter,
    permission_canUseTaiGerAI_filter,
    permission_TaiGerAIRatelimiter,
    processProgramListAi
  );

export = router;
