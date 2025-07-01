const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const { GeneralGETRequestRateLimiter } = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');

const {
  getTeamMembers,
  getStatistics,
  getResponseIntervalByStudent,
  getResponseTimeByStudent,
  getArchivStudents
} = require('../controllers/teams');
const {
  permission_canAccessStudentDatabase_filter
} = require('../middlewares/permission-filter');

const router = Router();

router.use(protect, permit(Role.Admin, Role.Agent, Role.Editor));

router
  .route('/')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getTeamMembers);
router
  .route('/statistics')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permission_canAccessStudentDatabase_filter,
    getStatistics
  );

router
  .route('/')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getTeamMembers);
router
  .route('/response-interval/:studentId')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permission_canAccessStudentDatabase_filter,
    getResponseIntervalByStudent
  );

router
  .route('/')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getTeamMembers);
router
  .route('/response-time/:studentId')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permission_canAccessStudentDatabase_filter,
    getResponseTimeByStudent
  );

router
  .route('/archiv/:TaiGerStaffId')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Agent, Role.Editor),
    permission_canAccessStudentDatabase_filter,
    getArchivStudents
  );

module.exports = router;
