import { Router } from 'express';
import { Role } from '@taiger-common/core';

import {
  GetTicketListRateLimiter,
  GetTicketRateLimiter,
  UpdateTicketRateLimiter,
  DeleteTicketRateLimiter,
  PostTicketRateLimiter
} from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';

import {
  getTickets,
  getTicketsOverview,
  createTicket,
  updateTicket,
  deleteTicket
} from '../controllers/tickets';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';
import { permission_canModifyTicketList_filter } from '../middlewares/permission-filter';

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
