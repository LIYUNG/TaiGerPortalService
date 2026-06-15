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
  getUnreadNumberMessages,
  IgnoreMessage,
  getChatFile
} from '../controllers/communications';
import { chatMultitenantFilter } from '../middlewares/chatMultitenantFilter';
import { MessagesChatUpload } from '../middlewares/file-upload';
import { validateStudentId } from '../common/validation';

const router = Router();

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
