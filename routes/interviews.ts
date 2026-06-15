import { Router } from 'express';
import { Role } from '@taiger-common/core';

import { protect, permit } from '../middlewares/auth';
import {
  getAllInterviewsPaginated,
  getMyInterviewPaginated,
  getInterview,
  getMyInterview,
  createInterview,
  deleteInterview,
  updateInterview,
  addInterviewTrainingDateTime,
  updateInterviewSurvey,
  getInterviewSurvey,
  getInterviewQuestions,
  getAllOpenInterviews,
  getInterviewsByProgramId,
  getInterviewsByStudentId
} from '../controllers/interviews';
import { multitenant_filter } from '../middlewares/multitenant-filter';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';
import {
  InterviewPUTRateLimiter,
  InterviewGETRateLimiter
} from '../middlewares/rate_limiter';
import {
  interviewMultitenantFilter,
  interviewMultitenantReadOnlyFilter
} from '../middlewares/interviewMultitenantFilter';
import { InnerTaigerMultitenantFilter } from '../middlewares/InnerTaigerMultitenantFilter';
import { auditLog } from '../utils/log/auditLog';
import { validateStudentId } from '../common/validation';

const router = Router();

router.use(protect);

router
  .route('/all/paginated')
  .get(
    filter_archiv_user,
    InterviewGETRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getAllInterviewsPaginated
  );

router
  .route('/my-interviews/paginated')
  .get(
    filter_archiv_user,
    InterviewGETRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    getMyInterviewPaginated
  );

router
  .route('/interview/:programId')
  .get(
    filter_archiv_user,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getInterviewsByProgramId
  );

router
  .route('/interviews/:studentId')
  .get(
    validateStudentId,
    filter_archiv_user,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getInterviewsByStudentId
  );

router
  .route('/questions/:programId')
  .get(
    filter_archiv_user,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getInterviewQuestions
  );

router
  .route('/my-interviews')
  .get(
    filter_archiv_user,
    InterviewGETRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    getMyInterview
  );

router.route('/open').get(filter_archiv_user, getAllOpenInterviews);

router
  .route('/:interview_id')
  .get(
    filter_archiv_user,
    InterviewGETRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    interviewMultitenantReadOnlyFilter,
    getInterview
  )
  .put(
    filter_archiv_user,
    InterviewPUTRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    interviewMultitenantFilter,
    updateInterview,
    auditLog
  )
  .delete(
    filter_archiv_user,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    interviewMultitenantFilter,
    deleteInterview
  );
router
  .route('/:interview_id/survey')
  .get(
    filter_archiv_user,
    InterviewPUTRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    interviewMultitenantReadOnlyFilter,
    getInterviewSurvey
  )
  .put(
    filter_archiv_user,
    InterviewPUTRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    interviewMultitenantFilter,
    updateInterviewSurvey
  );

router
  .route('/time/:interview_id')
  .post(
    filter_archiv_user,
    InterviewPUTRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    addInterviewTrainingDateTime
  );

router
  .route('/create/:program_id/:studentId')
  .post(
    filter_archiv_user,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    createInterview
  );
export = router;
