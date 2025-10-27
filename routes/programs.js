const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const {
  GetProgramListRateLimiter,
  GetProgramRateLimiter,
  UpdateProgramRateLimiter,
  DeleteProgramRateLimiter,
  PostProgramRateLimiter
} = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');

const {
  getPrograms,
  getProgram,
  createProgram,
  updateProgram,
  deleteProgram,
  getDistinctSchoolsAttributes,
  updateBatchSchoolAttributes,
  getProgramsOverview,
  getSchoolsDistribution,
  getSameProgramStudents
} = require('../controllers/programs');
const {
  getProgramChangeRequests,
  submitProgramChangeRequests,
  reviewProgramChangeRequest
} = require('../controllers/programChangeRequests');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');
const {
  permission_canModifyProgramList_filter
} = require('../middlewares/permission-filter');
const getProgramFilter = require('../middlewares/getProgramFilter');
const { validateProgramId } = require('../common/validation');

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

module.exports = router;
