import { Router } from 'express';
import { Role } from '@taiger-common/core';

import {
  GeneralPOSTRequestRateLimiter,
  GeneralGETRequestRateLimiter
} from '../middlewares/rate_limiter';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';
import { multitenant_filter } from '../middlewares/multitenant-filter';
import { InnerTaigerMultitenantFilter } from '../middlewares/InnerTaigerMultitenantFilter';
import { protect, permit, prohibit } from '../middlewares/auth';

import portalInformationsController from '../controllers/portal_informations';

const {
  createPortalCredentials,
  getPortalCredentials
  //   updateCourses,
} = portalInformationsController;

const router = Router();

router.use(protect);

router
  .route('/:studentId/:applicationId')
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Student, Role.Guest),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    createPortalCredentials
  );

router
  .route('/:studentId')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    prohibit(Role.Guest),
    multitenant_filter,
    getPortalCredentials
  );

export = router;
