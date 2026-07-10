import { Router } from 'express';
import { Role } from '@taiger-common/core';

import { protect, permit } from '../middlewares/auth';
import eventsController from '../controllers/events';

import {
  GeneralGETRequestRateLimiter,
  GeneralPUTRequestRateLimiter,
  GeneralDELETERequestRateLimiter,
  GeneralPOSTRequestRateLimiter
} from '../middlewares/rate_limiter';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';
import { event_multitenant_filter } from '../middlewares/event-filter';
import { validateStudentId } from '../common/validation';
// const handleError = require('../utils/eventErrors');

const {
  getEvents,
  getEventsPaginated,
  getBookedEvents,
  showEvent,
  updateEvent,
  postEvent,
  deleteEvent,
  confirmEvent,
  getActiveEventsNumber
} = eventsController;

const router = Router();

router.use(protect);

router
  .route('/ping')
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    getActiveEventsNumber
  );

router
  .route('/booked')
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    getBookedEvents
  );

router
  .route('/paginated')
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    getEventsPaginated
  );

router
  .route('/')
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    getEvents
  )
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    // TODO: prevent student change receiver_id!
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    postEvent
  );

router
  .route('/:studentId/show')
  .get(
    validateStudentId,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    showEvent
  );

router
  .route('/:event_id/confirm')
  .put(
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    event_multitenant_filter,
    confirmEvent
  );

router
  .route('/:event_id')
  .put(
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    event_multitenant_filter,
    updateEvent
  )
  .delete(
    filter_archiv_user,
    GeneralDELETERequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    event_multitenant_filter,
    deleteEvent
  );

export = router;
