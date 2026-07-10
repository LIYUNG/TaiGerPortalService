import { Router } from 'express';
import { Role } from '@taiger-common/core';

import {
  GeneralGETRequestRateLimiter,
  GeneralPUTRequestRateLimiter
} from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';
import notesController from '../controllers/notes';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';

const { getStudentNotes, updateStudentNotes } = notesController;

const router = Router();
router.use(protect);

router
  .route('/:student_id')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getStudentNotes
  )
  .put(
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    updateStudentNotes
  );

export = router;
