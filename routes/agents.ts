import { Router } from 'express';
import { Role } from '@taiger-common/core';
import { GeneralGETRequestRateLimiter } from '../middlewares/rate_limiter';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';

import { protect, permit } from '../middlewares/auth';
import { getAgentProfile, putAgentProfile } from '../controllers/teams';

const router = Router();

router.use(protect);

router
  .route('/profile/:agent_id')
  .put(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent),
    putAgentProfile
  )
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    getAgentProfile
  );

module.exports = router;
