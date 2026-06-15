import { Router } from 'express';
import { Role } from '@taiger-common/core';

import { GeneralGETRequestRateLimiter } from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';
import { multitenant_filter } from '../middlewares/multitenant-filter';

import { filter_archiv_user } from '../middlewares/limit_archiv_user';

import { getStudentUniAssist } from '../controllers/uniassist';
import { permission_canAccessStudentDatabase_filter } from '../middlewares/permission-filter';

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

export = router;
