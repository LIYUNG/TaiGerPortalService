import { Router } from 'express';
import { Role } from '@taiger-common/core';

import {
  getMessagesRateLimiter,
  postMessagesRateLimiter,
  postMessagesImageRateLimiter,
  GeneralGETSearchRequestRateLimiter,
  getNumberUnreadMessagesRateLimiter
} from '../middlewares/rate_limiter';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';
import { multitenant_filter } from '../middlewares/multitenant-filter';
import { protect, permit } from '../middlewares/auth';
import {
  getMessages,
  updateAMessageInThread,
  deleteAMessageInCommunicationThread,
  postMessages,
  getMyMessages,
  loadMessages,
  getSearchUserMessages,
  searchThreadMessages,
  getThreadContextMessages,
  getAdjacentThreadMessages,
  getUnreadNumberMessages,
  IgnoreMessage,
  getChatFile,
  getCommunicationDraft,
  upsertCommunicationDraft,
  deleteCommunicationDraft,
  uploadCommunicationDraftFiles,
  deleteCommunicationDraftFile
} from '../controllers/communications';
import { chatMultitenantFilter } from '../middlewares/chatMultitenantFilter';
import { MessagesChatUpload } from '../middlewares/file-upload';
import { validateStudentId } from '../common/validation';
import { ErrorResponse } from '../common/errors';
import logger from '../services/logger';

const router = Router();

// multer-S3 errors (file filter, size, or an S3 upload failure) can otherwise
// escape as an uncaught exception. Run the upload, then forward any error as a
// clean response so the client sees a real message instead of a dead request.
const safeChatUpload = (req, res, next) => {
  MessagesChatUpload(req, res, (err) => {
    if (err) {
      logger.error('chat draft upload failed', {
        name: err?.name,
        code: err?.code ?? err?.Code,
        message: err?.message
      });
      return next(
        new ErrorResponse(
          err?.statusCode || 500,
          err?.message || 'Upload failed'
        )
      );
    }
    next();
  });
};

router.use(protect);
router
  .route('/')
  .get(
    GeneralGETSearchRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getSearchUserMessages
  );

router
  .route('/ping/all')
  .get(
    getNumberUnreadMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    getUnreadNumberMessages
  );

router
  .route('/all')
  .get(
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getMyMessages
  );

router
  .route('/:studentId/search')
  .get(
    validateStudentId,
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    chatMultitenantFilter,
    searchThreadMessages
  );

router
  .route('/:studentId/context/:messageId')
  .get(
    validateStudentId,
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    chatMultitenantFilter,
    getThreadContextMessages
  );

router
  .route('/:studentId/adjacent/:messageId')
  .get(
    validateStudentId,
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    chatMultitenantFilter,
    getAdjacentThreadMessages
  );

// NOTE: must be registered BEFORE '/:studentId/:messageId' so that "draft" is
// not captured as a messageId.
router
  .route('/:studentId/draft')
  .get(
    validateStudentId,
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    chatMultitenantFilter,
    getCommunicationDraft
  )
  .put(
    validateStudentId,
    filter_archiv_user,
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    chatMultitenantFilter,
    upsertCommunicationDraft
  )
  .delete(
    validateStudentId,
    filter_archiv_user,
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    chatMultitenantFilter,
    deleteCommunicationDraft
  );

// Draft attachments (upload-on-attach). Registered before '/:studentId/:messageId'.
router
  .route('/:studentId/draft/files')
  .post(
    validateStudentId,
    filter_archiv_user,
    postMessagesImageRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    chatMultitenantFilter,
    safeChatUpload,
    uploadCommunicationDraftFiles
  )
  .delete(
    validateStudentId,
    filter_archiv_user,
    postMessagesImageRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    chatMultitenantFilter,
    deleteCommunicationDraftFile
  );

router
  .route('/:studentId/:communication_messageId/:ignoreMessageState/ignore')
  .put(
    validateStudentId,
    filter_archiv_user,
    postMessagesImageRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    multitenant_filter,
    chatMultitenantFilter,
    IgnoreMessage
  );

router
  .route('/:studentId/:messageId')
  .put(
    validateStudentId,
    filter_archiv_user,
    postMessagesImageRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    chatMultitenantFilter,
    updateAMessageInThread
  )
  .delete(
    validateStudentId,
    filter_archiv_user,
    postMessagesImageRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    chatMultitenantFilter,
    deleteAMessageInCommunicationThread
  );

router
  .route('/:studentId')
  .post(
    validateStudentId,
    filter_archiv_user,
    postMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    chatMultitenantFilter,
    MessagesChatUpload,
    postMessages
  )
  .get(
    validateStudentId,
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    chatMultitenantFilter,
    getMessages
  );

router
  .route('/:studentId/chat/:fileName')
  .get(
    validateStudentId,
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    chatMultitenantFilter,
    getChatFile
  );

router
  .route('/:studentId/pages/:pageNumber')
  .get(
    validateStudentId,
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    chatMultitenantFilter,
    loadMessages
  );

export = router;
