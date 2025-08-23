const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const { GeneralGETRequestRateLimiter } = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');
const {
  getAdmissions,
  getAdmissionsYear,
  getAdmissionLetter
} = require('../controllers/admissions');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');
const {
  permission_canAccessStudentDatabase_filter
} = require('../middlewares/permission-filter');
const { multitenant_filter } = require('../middlewares/multitenant-filter');
const { validateStudentId } = require('../common/validation');

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
