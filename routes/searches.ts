import { Router } from 'express';
import { Role } from '@taiger-common/core';

import { GeneralGETSearchRequestRateLimiter } from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';

import {
  getQueryResults,
  getQueryPublicResults,
  getQueryStudentsResults
} from '../controllers/search';

const router = Router();

router.use(protect);

// TODO: when public documents ready, then enable
// router
//   .route('/public')
//   .get(
//     GeneralGETSearchRequestRateLimiter,
//     permit(Role.Student),
//     getQueryPublicResults
//   );

router
  .route('/students')
  .get(
    GeneralGETSearchRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getQueryStudentsResults
  );

router
  .route('/')
  .get(
    GeneralGETSearchRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getQueryResults
  );

export = router;
