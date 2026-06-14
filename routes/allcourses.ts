import { Router } from 'express';
import { Role } from '@taiger-common/core';

import { GeneralGETRequestRateLimiter } from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';
import {
  getCourses,
  getCourse,
  deleteCourse,
  updateCourse,
  createCourse
} from '../controllers/allcourses';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';
import { validateCourseId } from '../common/validation';

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
