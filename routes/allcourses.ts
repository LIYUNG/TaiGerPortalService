const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const { GeneralGETRequestRateLimiter } = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');
const {
  getCourses,
  getCourse,
  deleteCourse,
  updateCourse,
  createCourse
} = require('../controllers/allcourses');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');
const { validateCourseId } = require('../common/validation');

const router = Router();
router.use(protect);

router
  .route('/')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.External),
    getCourses
  )
  .post(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.External),
    createCourse
  );

router
  .route('/:courseId')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.External),
    validateCourseId,
    getCourse
  )
  .put(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.External),
    validateCourseId,
    updateCourse
  )
  .delete(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.External),
    validateCourseId,
    deleteCourse
  );

module.exports = router;
