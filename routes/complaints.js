const { Router } = require('express');
const { Role } = require('@taiger-common/core');
const {
  GetComplaintListRateLimiter,
  GetComplaintRateLimiter,
  UpdateComplaintRateLimiter,
  DeleteComplaintRateLimiter,
  PostComplaintRateLimiter
} = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');

const {
  getComplaints,
  getComplaint,
  createComplaint,
  updateComplaint,
  deleteComplaint,
  deleteAMessageInComplaint,
  postMessageInTicket,
  getMessageFileInTicket,
  updateAMessageInComplaint
} = require('../controllers/complaints');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');
const {
  complaintTicketMultitenant_filter
} = require('../middlewares/multitenant-filter');
const { MessagesTicketUpload } = require('../middlewares/file-upload');
const { validateStudentId } = require('../common/validation');
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

module.exports = router;
