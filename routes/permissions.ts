import { Router } from 'express';
import { Role } from '@taiger-common/core';

import {
  GeneralPOSTRequestRateLimiter,
  GeneralGETRequestRateLimiter
} from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';
import {
  updateUserPermission,
  getUserPermission
} from '../controllers/permissions';

const router = Router();

router.use(protect, permit(Role.Admin));

router
  .route('/:user_id')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getUserPermission)
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    updateUserPermission
  );

module.exports = router;
