import { Router } from 'express';
import { Role } from '@taiger-common/core';

import {
  getMessagesRateLimiter,
  postMessagesRateLimiter,
  postMessagesImageRateLimiter,
  GeneralPOSTRequestRateLimiter,
  SetStatusMessagesThreadRateLimiter,
  GeneralDELETERequestRateLimiter,
  getMessageFileRateLimiter,
  putThreadInputRateLimiter,
  putMessagesRateLimiter
} from '../middlewares/rate_limiter';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';
import { multitenant_filter } from '../middlewares/multitenant-filter';
import { chatMultitenantFilter } from '../middlewares/chatMultitenantFilter';
import { InnerTaigerMultitenantFilter } from '../middlewares/InnerTaigerMultitenantFilter';
import { doc_thread_ops_validator } from '../middlewares/docs_thread_operation_validation';
import { protect, permit } from '../middlewares/auth';
import {
  MessagesThreadUpload,
  MessagesImageThreadUpload
} from '../middlewares/file-upload';

import {
  getActiveThreads,
  getActiveThreadsPaginated,
  getActiveThreadsCounts,
  getMyStudentsThreadsPaginated,
  getMyStudentsThreadsCounts,
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
  putOriginAuthorConfirmedByStudent,
  putThreadFavorite,
  IgnoreMessageInDocumentThread,
  checkDocumentPattern,
  getMyStudentMetrics,
  getThreadsByStudent,
  getMyStudentsThreads,
  forwardStudentDocuments
} from '../controllers/documents_modification';
import cvDraftController from '../controllers/cv_draft';
import {
  docThreadMultitenant_filter,
  surveyMultitenantFilter
} from '../middlewares/documentThreadMultitenantFilter';
import { editorIdsBodyFilter } from '../middlewares/editorIdsBodyFilter';
import { AssignOutsourcerFilter } from '../middlewares/AssignOutsourcerFilter';
import { auditLog } from '../utils/log/auditLog';
import { validateStudentId } from '../common/validation';

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
    getMyStudentMetrics
  );

router
  .route('/overview/taiger-user/:userId')
  .get(
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getMyStudentsThreads
  );

router
  .route('/overview/taiger-user/:userId/paginated')
  .get(
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getMyStudentsThreadsPaginated
  );

router
  .route('/overview/taiger-user/:userId/counts')
  .get(
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getMyStudentsThreadsCounts
  );

router
  .route('/overview/all')
  .get(
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getActiveThreads
  );

router
  .route('/overview/all/paginated')
  .get(
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getActiveThreadsPaginated
  );

router
  .route('/overview/all/counts')
  .get(
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getActiveThreadsCounts
  );

router
  .route('/survey-input/:surveyInputId')
  .put(
    putThreadInputRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    surveyMultitenantFilter,
    putSurveyInput
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
    validateStudentId,
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    getThreadsByStudent
  );

router
  .route('/init/general/:studentId/:document_category')
  .post(
    validateStudentId,
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    initGeneralMessagesThread
  );

router
  .route('/init/application/:studentId/:application_id/:document_category')
  .post(
    validateStudentId,
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
    IgnoreMessageInDocumentThread
  );

router
  .route('/:messagesThreadId/favorite')
  .put(
    filter_archiv_user,
    putMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    docThreadMultitenant_filter,
    putThreadFavorite
  );

router
  .route('/:messagesThreadId/additional-information')
  .put(
    filter_archiv_user,
    putMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    docThreadMultitenant_filter,
    cvDraftController.updateAdditionalInformation
  );

router
  .route('/:messagesThreadId/:studentId/origin-author')
  .put(
    validateStudentId,
    SetStatusMessagesThreadRateLimiter,
    permit(Role.Student),
    multitenant_filter,
    putOriginAuthorConfirmedByStudent
  );

// Forward a student's documents by email. Registered BEFORE the generic
// '/:messagesThreadId/:studentId' route so "forward-documents" is not captured
// as a :studentId. chatMultitenantFilter restricts to staff assigned to the
// student (or canAccessAllChat) — preventing forwarding of an unassigned
// student's documents.
router
  .route('/:studentId/forward-documents')
  .post(
    validateStudentId,
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    multitenant_filter,
    chatMultitenantFilter,
    forwardStudentDocuments
  );

// TODO: to find a better filter considering essay writer
router
  .route('/:messagesThreadId/:studentId')
  .put(
    validateStudentId,
    filter_archiv_user,
    SetStatusMessagesThreadRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    SetStatusMessagesThread,
    auditLog
  )
  .post(
    validateStudentId,
    filter_archiv_user,
    postMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    doc_thread_ops_validator,
    MessagesThreadUpload,
    postMessages
  )
  .delete(
    validateStudentId,
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
    validateStudentId,
    filter_archiv_user,
    postMessagesImageRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    getMessageImageDownload
  );
router
  .route('/image/:messagesThreadId/:studentId')
  .post(
    validateStudentId,
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
    validateStudentId,
    filter_archiv_user,
    getMessageFileRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    docThreadMultitenant_filter,
    getMessageFileDownload
  );

router
  .route('/:messagesThreadId/:application_id/:studentId')
  .delete(
    validateStudentId,
    filter_archiv_user,
    GeneralDELETERequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    doc_thread_ops_validator,
    handleDeleteProgramThread
  );

export = router;
