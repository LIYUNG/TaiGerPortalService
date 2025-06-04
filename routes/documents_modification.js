const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const {
  getMessagesRateLimiter,
  postMessagesRateLimiter,
  postMessagesImageRateLimiter,
  GeneralPOSTRequestRateLimiter,
  SetStatusMessagesThreadRateLimiter,
  GeneralPUTRequestRateLimiter,
  GeneralDELETERequestRateLimiter,
  getMessageFileRateLimiter,
  putThreadInputRateLimiter,
  resetThreadInputRateLimiter,
  putMessagesRateLimiter
} = require('../middlewares/rate_limiter');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');
const { multitenant_filter } = require('../middlewares/multitenant-filter');
const {
  InnerTaigerMultitenantFilter
} = require('../middlewares/InnerTaigerMultitenantFilter');
const {
  doc_thread_ops_validator
} = require('../middlewares/docs_thread_operation_validation');
const { protect, permit } = require('../middlewares/auth');
const {
  MessagesThreadUpload,
  MessagesImageThreadUpload
} = require('../middlewares/file-upload');

const {
  getActiveThreads,
  initGeneralMessagesThread,
  initApplicationMessagesThread,
  getMessages,
  getMessageImageDownload,
  getMessageFileDownload,
  SetStatusMessagesThread,
  handleDeleteGeneralThread,
  handleDeleteProgramThread,
  deleteAMessageInThread,
  postImageInThread,
  postMessages,
  getSurveyInputs,
  postSurveyInput,
  putSurveyInput,
  assignEssayWritersToEssayTask,
  resetSurveyInput,
  putOriginAuthorConfirmedByStudent,
  putThreadFavorite,
  IgnoreMessageInDocumentThread,
  checkDocumentPattern,
  getMyStudentMetrics,
  getThreadsByStudent,
  getMyStudentsThreads
} = require('../controllers/documents_modification');
const {
  docThreadMultitenant_filter,
  surveyMultitenantFilter
} = require('../middlewares/documentThreadMultitenantFilter');
const {
  permission_canAssignEditor_filter,
  permission_canAssignAgent_filter,
  permission_canAccessStudentDatabase_filter
} = require('../middlewares/permission-filter');
const { logAccess } = require('../utils/log/log');
const { editorIdsBodyFilter } = require('../middlewares/editorIdsBodyFilter');
const {
  AssignOutsourcerFilter
} = require('../middlewares/AssignOutsourcerFilter');
const { auditLog } = require('../utils/log/auditLog');
const router = Router();

router.use(protect);

router
  .route('/pattern/check/:messagesThreadId/:file_type')
  .get(
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    checkDocumentPattern
  );

router
  .route('/overview/my-student-metrics')
  .get(
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getMyStudentMetrics,
    logAccess
  );

router
  .route('/overview/taiger-user/:userId')
  .get(
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getMyStudentsThreads
  );

router
  .route('/overview/all')
  .get(
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getActiveThreads
  );

router
  .route('/survey-input/:surveyInputId')
  .put(
    putThreadInputRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    surveyMultitenantFilter,
    putSurveyInput
  )
  .delete(
    resetThreadInputRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    surveyMultitenantFilter,
    resetSurveyInput
  );

router
  .route('/survey-input')
  .post(
    putThreadInputRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    surveyMultitenantFilter,
    postSurveyInput
  );

router
  .route('/student-threads/:studentId')
  .get(
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getThreadsByStudent
  );

router
  .route('/init/general/:studentId/:document_category')
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    initGeneralMessagesThread
  );

router
  .route('/init/application/:studentId/:program_id/:document_category')
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    initApplicationMessagesThread
  );

router
  .route('/:messagesThreadId/essay')
  .post(
    filter_archiv_user,
    postMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent),
    AssignOutsourcerFilter,
    editorIdsBodyFilter,
    doc_thread_ops_validator,
    assignEssayWritersToEssayTask,
    auditLog
  );

router
  .route('/:messagesThreadId/:messageId/:ignoreMessageState/ignored')
  .put(
    filter_archiv_user,
    putMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent),
    docThreadMultitenant_filter,
    IgnoreMessageInDocumentThread,
    logAccess
  );

router
  .route('/:messagesThreadId/favorite')
  .put(
    filter_archiv_user,
    putMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    docThreadMultitenant_filter,
    putThreadFavorite,
    logAccess
  );

router
  .route('/:messagesThreadId/:studentId/origin-author')
  .put(
    SetStatusMessagesThreadRateLimiter,
    permit(Role.Student),
    multitenant_filter,
    putOriginAuthorConfirmedByStudent
  );

// TODO: to find a better filter considering essay writer
router
  .route('/:messagesThreadId/:studentId')
  .put(
    filter_archiv_user,
    SetStatusMessagesThreadRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    SetStatusMessagesThread,
    auditLog
  )
  .post(
    filter_archiv_user,
    postMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    doc_thread_ops_validator,
    MessagesThreadUpload,
    postMessages
  )
  .delete(
    filter_archiv_user,
    GeneralDELETERequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    multitenant_filter,
    doc_thread_ops_validator,
    InnerTaigerMultitenantFilter,
    handleDeleteGeneralThread
  );
// TODO: multitenancy: check user id match user_id in message
router
  .route('/delete/:messagesThreadId/:messageId')
  .delete(
    filter_archiv_user,
    postMessagesImageRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    docThreadMultitenant_filter,
    deleteAMessageInThread
  );
// Get image in thread
router
  .route('/image/:messagesThreadId/:studentId/:file_name')
  .get(
    filter_archiv_user,
    postMessagesImageRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    getMessageImageDownload
  );
router
  .route('/image/:messagesThreadId/:studentId')
  .post(
    filter_archiv_user,
    postMessagesImageRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    doc_thread_ops_validator,
    MessagesImageThreadUpload,
    postImageInThread
  );

// Multitenant-filter in call-back function

router
  .route('/:messagesThreadId/survey-inputs')
  .get(
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    docThreadMultitenant_filter,
    getSurveyInputs
  );

router
  .route('/:messagesThreadId')
  .get(
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    docThreadMultitenant_filter,
    getMessages
  );

router
  .route('/:studentId/:messagesThreadId/:file_key')
  .get(
    filter_archiv_user,
    getMessageFileRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    docThreadMultitenant_filter,
    getMessageFileDownload
  );

router
  .route('/:messagesThreadId/:program_id/:studentId')
  .delete(
    filter_archiv_user,
    GeneralDELETERequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    doc_thread_ops_validator,
    handleDeleteProgramThread
  );

module.exports = router;
