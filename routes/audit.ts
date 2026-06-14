import { Router } from 'express';
import { Role } from '@taiger-common/core';

import { GeneralGETRequestRateLimiter } from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';

import { getAuditLogs } from '../controllers/audit';

const router = Router();

router.use(protect);

router
  .route('/')
  .get(
    GeneralGETRequestRateLimiter,
    filter_archiv_user,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getAuditLogs
  );

module.exports = router;
