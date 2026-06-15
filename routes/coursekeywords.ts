import { Router } from 'express';
import { Role } from '@taiger-common/core';

import {
  GeneralPOSTRequestRateLimiter,
  GeneralPUTRequestRateLimiter,
  GeneralDELETERequestRateLimiter
} from '../middlewares/rate_limiter';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';
import { protect, permit } from '../middlewares/auth';
import {
  createKeywordSet,
  updateKeywordSet,
  deleteKeywordSet,
  getKeywordSets
} from '../controllers/coursekeywords';

const router = Router();

router.use(protect);

router
  .route('/')
  .get(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.External),
    getKeywordSets
  );

router
  .route('/:keywordsSetId')
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.External),
    createKeywordSet
  )
  .put(
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.External),
    updateKeywordSet
  )
  .delete(
    GeneralDELETERequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.External),
    deleteKeywordSet
  );

export = router;
