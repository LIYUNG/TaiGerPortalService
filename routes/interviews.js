const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const { protect, permit } = require('../middlewares/auth');
const {
  getAllInterviews,
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
} = require('../controllers/interviews');
const { multitenant_filter } = require('../middlewares/multitenant-filter');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');
const {
  InterviewPUTRateLimiter,
  InterviewGETRateLimiter
} = require('../middlewares/rate_limiter');
const {
  interviewMultitenantFilter,
  interviewMultitenantReadOnlyFilter
} = require('../middlewares/interviewMultitenantFilter');
const {
  InnerTaigerMultitenantFilter
} = require('../middlewares/InnerTaigerMultitenantFilter');
const { auditLog } = require('../utils/log/auditLog');

const router = Router();

router.use(protect);

router
  .route('/')
  .get(
    filter_archiv_user,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getAllInterviews
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
module.exports = router;
