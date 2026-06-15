import { Router } from 'express';
import { Role } from '@taiger-common/core';

import {
  GetProgramListRateLimiter,
  GetProgramRateLimiter,
  UpdateProgramRateLimiter,
  DeleteProgramRateLimiter,
  PostProgramRateLimiter
} from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';

import {
  getPrograms,
  getProgram,
  createProgram,
  updateProgram,
  deleteProgram,
  refreshProgram,
  getDistinctSchoolsAttributes,
  updateBatchSchoolAttributes,
  getProgramsOverview,
  getSchoolsDistribution,
  getSameProgramStudents
} from '../controllers/programs';
import {
  getProgramChangeRequests,
  submitProgramChangeRequests,
  reviewProgramChangeRequest
} from '../controllers/programChangeRequests';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';
import { permission_canModifyProgramList_filter } from '../middlewares/permission-filter';
import getProgramFilter from '../middlewares/getProgramFilter';
import { validateProgramId } from '../common/validation';

const router = Router();

router.use(protect);

router
  .route('/overview')
  .get(
    filter_archiv_user,
    GetProgramListRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.External),
    getProgramsOverview
  );

router
  .route('/schools-distribution')
  .get(
    filter_archiv_user,
    GetProgramListRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.External),
    getSchoolsDistribution
  );

router
  .route('/same-program-students/:programId')
  .get(
    filter_archiv_user,
    GetProgramListRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getSameProgramStudents
  );

router
  .route('/')
  .get(
    filter_archiv_user,
    GetProgramListRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.External),
    getPrograms
  )
  .post(
    filter_archiv_user,
    PostProgramRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.External),
    permission_canModifyProgramList_filter,
    createProgram
  );

router
  .route('/schools')
  .get(
    filter_archiv_user,
    GetProgramListRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.External),
    getDistinctSchoolsAttributes
  )
  .put(
    filter_archiv_user,
    GetProgramListRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.External),
    updateBatchSchoolAttributes
  );

router
  .route('/:programId')
  .get(
    validateProgramId,
    filter_archiv_user,
    GetProgramRateLimiter,
    permit(
      Role.Admin,
      Role.Manager,
      Role.Agent,
      Role.Editor,
      Role.External,
      Role.Student
    ),
    getProgramFilter,
    getProgram
  )
  .put(
    validateProgramId,
    filter_archiv_user,
    UpdateProgramRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.External),
    permission_canModifyProgramList_filter,
    updateProgram
  )
  .delete(
    validateProgramId,
    DeleteProgramRateLimiter,
    permit(Role.Admin),
    permission_canModifyProgramList_filter,
    deleteProgram
  );

router
  .route('/:programId/refresh')
  .post(
    validateProgramId,
    filter_archiv_user,
    UpdateProgramRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.External),
    permission_canModifyProgramList_filter,
    refreshProgram
  );

router
  .route('/:programId/change-requests')
  .get(
    validateProgramId,
    filter_archiv_user,
    GetProgramRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.External),
    getProgramChangeRequests
  )
  .post(
    validateProgramId,
    filter_archiv_user,
    PostProgramRateLimiter,
    permit(
      Role.Admin,
      Role.Manager,
      Role.Agent,
      Role.Editor,
      Role.External,
      Role.Student
    ),
    submitProgramChangeRequests
  );

router
  .route('/review-changes/:requestId')
  .post(
    filter_archiv_user,
    UpdateProgramRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.External),
    reviewProgramChangeRequest
  );

export = router;
