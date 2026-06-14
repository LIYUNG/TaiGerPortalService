import { Router } from 'express';
import { Role } from '@taiger-common/core';

import { getMessagesRateLimiter } from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';

import { getApplicationConflicts } from '../controllers/student_applications';

import { getApplicationDeltas } from '../controllers/teams';

const router = Router();

router.use(protect);

router
  .route('/conflicts')
  .get(
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getApplicationConflicts
  );

router
  .route('/deltas')
  .get(
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getApplicationDeltas
  );

module.exports = router;
