const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const {
  GetTicketListRateLimiter,
  GetTicketRateLimiter,
  UpdateTicketRateLimiter,
  DeleteTicketRateLimiter,
  PostTicketRateLimiter
} = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');

const {
  getTickets,
  getTicketsOverview,
  createTicket,
  updateTicket,
  deleteTicket
} = require('../controllers/tickets');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');
const {
  permission_canModifyTicketList_filter
} = require('../middlewares/permission-filter');

const router = Router();

router.use(protect);

// Paginated + searchable overview of tickets (internal tool — staff only).
// Declared before '/' so the static segment is matched explicitly.
router
  .route('/overview')
  .get(
    filter_archiv_user,
    GetTicketListRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getTicketsOverview
  );

router
  .route('/')
  .get(
    filter_archiv_user,
    GetTicketListRateLimiter,
    permit(
      Role.Admin,
      Role.Manager,
      Role.Agent,
      Role.Editor,
      Role.Student,
      Role.External
    ),
    getTickets
  )
  .post(
    filter_archiv_user,
    PostTicketRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Student, Role.External),
    // permission_canModifyTicketList_filter,
    createTicket
  );

router
  .route('/:ticket_id')
  .put(
    filter_archiv_user,
    UpdateTicketRateLimiter,
    permit(
      Role.Admin,
      Role.Manager,
      Role.Editor,
      Role.Agent,
      Role.Student,
      Role.External
    ),
    // permission_canModifyTicketList_filter,
    updateTicket
  )
  .delete(
    filter_archiv_user,
    DeleteTicketRateLimiter,
    permit(
      Role.Admin,
      Role.Manager,
      Role.Editor,
      Role.Agent,
      Role.Student,
      Role.External
    ),
    // permission_canModifyTicketList_filter,
    deleteTicket
  );

module.exports = router;
