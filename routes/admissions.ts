import { Router } from 'express';
import { Role } from '@taiger-common/core';

import { GeneralGETRequestRateLimiter } from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';
import {
  getAdmissions,
  getAdmissionsOverview,
  getAdmissionsYear,
  getAdmissionLetter
} from '../controllers/admissions';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';
import { permission_canAccessStudentDatabase_filter } from '../middlewares/permission-filter';
import { multitenant_filter } from '../middlewares/multitenant-filter';
import { validateStudentId } from '../common/validation';

const router = Router();
router.use(protect);

router
  .route('/')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    permission_canAccessStudentDatabase_filter,
    getAdmissions
  );

router
  .route('/overview')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    permission_canAccessStudentDatabase_filter,
    getAdmissionsOverview
  );

router
  .route('/:studentId/admission/:fileName')
  .get(
    validateStudentId,
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    permission_canAccessStudentDatabase_filter,
    getAdmissionLetter
  );

// TODO
router
  .route('/:applications_year')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    permission_canAccessStudentDatabase_filter,
    getAdmissionsYear
  );

module.exports = router;
