import { Router } from 'express';
import { Role } from '@taiger-common/core';

import { GeneralGETRequestRateLimiter } from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';
import {
  processProgramListAi,
  cvmlrlAi,
  TaiGerAiChat
} from '../controllers/taigerais';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';
import {
  permission_canModifyProgramList_filter,
  permission_canUseTaiGerAI_filter,
  permission_TaiGerAIRatelimiter
} from '../middlewares/permission-filter';
import { chatMultitenantFilter } from '../middlewares/chatMultitenantFilter';

const router = Router();
router.use(protect);

router
  .route('/chat/:studentId')
  .post(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    chatMultitenantFilter,
    permission_canUseTaiGerAI_filter,
    permission_TaiGerAIRatelimiter,
    TaiGerAiChat
  );

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
