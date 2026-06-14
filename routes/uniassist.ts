const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const { GeneralGETRequestRateLimiter } = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');
const { multitenant_filter } = require('../middlewares/multitenant-filter');

const { filter_archiv_user } = require('../middlewares/limit_archiv_user');

const { getStudents } = require('../controllers/students');
const { getStudentUniAssist } = require('../controllers/uniassist');
const {
  permission_canAccessStudentDatabase_filter
} = require('../middlewares/permission-filter');

const router = Router();

router.use(protect);

// router
//   .route('/')
//   .get(
//     GeneralGETRequestRateLimiter,
//     permit(
//       Role.Admin,
//       Role.Manager,
//       Role.Agent,
//       Role.Editor,
//       Role.Student,
//       Role.Guest
//     ),
//     permission_canAccessStudentDatabase_filter,
//     getStudents
//   );

router
  .route('/:studentId')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    permission_canAccessStudentDatabase_filter,
    multitenant_filter,
    getStudentUniAssist
  );

module.exports = router;
