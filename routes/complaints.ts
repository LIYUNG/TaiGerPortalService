import { Router } from 'express';
import { Role } from '@taiger-common/core';
import {
  GetComplaintListRateLimiter,
  GetComplaintRateLimiter,
  UpdateComplaintRateLimiter,
  DeleteComplaintRateLimiter,
  PostComplaintRateLimiter
} from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';

import {
  getComplaints,
  getComplaint,
  createComplaint,
  updateComplaint,
  deleteComplaint,
  deleteAMessageInComplaint,
  postMessageInTicket,
  getMessageFileInTicket,
  updateAMessageInComplaint
} from '../controllers/complaints';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';
import { complaintTicketMultitenant_filter } from '../middlewares/multitenant-filter';
import { MessagesTicketUpload } from '../middlewares/file-upload';
import { validateStudentId } from '../common/validation';
// const {
//   permission_canModifyComplaintList_filter
// } = require('../middlewares/permission-filter');

const router = Router();

router.use(protect);

router
  .route('/')
  .get(
    filter_archiv_user,
    GetComplaintListRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    getComplaints
  )
  .post(
    filter_archiv_user,
    PostComplaintRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Student),
    // permission_canModifyComplaintList_filter,
    createComplaint
  );

// TODO: multitenant, prevent students accessing others
router
  .route('/:ticketId')
  .get(
    filter_archiv_user,
    GetComplaintRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    complaintTicketMultitenant_filter,
    getComplaint
  )
  .put(
    filter_archiv_user,
    UpdateComplaintRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    complaintTicketMultitenant_filter,
    updateComplaint
  )
  .delete(
    filter_archiv_user,
    DeleteComplaintRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    complaintTicketMultitenant_filter,
    deleteComplaint
  );

// TODO: Test update
router
  .route('/:ticketId/:messageId')
  .put(
    filter_archiv_user,
    UpdateComplaintRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    complaintTicketMultitenant_filter,
    updateAMessageInComplaint
  )
  .delete(
    filter_archiv_user,
    DeleteComplaintRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    complaintTicketMultitenant_filter,
    deleteAMessageInComplaint
  );

router
  .route('/:studentId/:ticketId/:fileKey')
  .get(
    validateStudentId,
    filter_archiv_user,
    UpdateComplaintRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    complaintTicketMultitenant_filter,
    MessagesTicketUpload,
    getMessageFileInTicket
  );

router
  .route('/new-message/:ticketId/:studentId')
  .post(
    validateStudentId,
    filter_archiv_user,
    UpdateComplaintRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    complaintTicketMultitenant_filter,
    MessagesTicketUpload,
    postMessageInTicket
  );

export = router;
