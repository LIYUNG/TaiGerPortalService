import { Router } from 'express';
import { Role } from '@taiger-common/core';

import {
  GeneralGETRequestRateLimiter,
  getMessagesRateLimiter,
  postMessagesImageRateLimiter,
  GeneralPUTRequestRateLimiter
} from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';

import {
  getApplications,
  getStudentApplications,
  deleteApplication,
  createApplicationV2,
  updateStudentApplications,
  getActiveStudentsApplicationsPaginated,
  getApplicationsDeadlineDistribution,
  getApplicationProgramsUpdateStatus,
  getMyStudentsApplicationsStats,
  updateApplication,
  withdrawApplication,
  refreshApplication
} from '../controllers/applications';
import { multitenant_filter } from '../middlewares/multitenant-filter';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';
import { InnerTaigerMultitenantFilter } from '../middlewares/InnerTaigerMultitenantFilter';
import { validateStudentId } from '../common/validation';

const router = Router();

router.use(protect);

router
  .route('/')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getApplications
  );

router.route('/application/:application_id').delete(
  getMessagesRateLimiter,
  permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor), // TODO: Add multitenant_filter?
  deleteApplication
);

router
  .route('/:applicationId/refresh')
  .post(
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    refreshApplication
  );

router
  .route('/all/active/applications/paginated')
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getActiveStudentsApplicationsPaginated
  );

router
  .route('/distribution')
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getApplicationsDeadlineDistribution
  );

router
  .route('/program-update-status')
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getApplicationProgramsUpdateStatus
  );

router.route('/student/:studentId/:application_id').put(
  validateStudentId,
  getMessagesRateLimiter,
  permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor), // TODO: Add multitenant_filter?
  multitenant_filter,
  InnerTaigerMultitenantFilter,
  updateApplication
);

router
  .route('/student/:studentId/:application_id/withdraw')
  .put(
    validateStudentId,
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    withdrawApplication
  );

router
  .route('/taiger-user/:userId/stats')
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getMyStudentsApplicationsStats
  );

router
  .route('/student/:studentId')
  .get(
    validateStudentId,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    getStudentApplications
  )
  .put(
    validateStudentId,
    // TODO: not implemented yet (UI dependent!)
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Student),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    updateStudentApplications
  )
  .post(
    validateStudentId,
    filter_archiv_user,
    postMessagesImageRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    createApplicationV2
  );

export = router;
