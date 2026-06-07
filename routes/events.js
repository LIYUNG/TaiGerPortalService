const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const { protect, permit } = require('../middlewares/auth');
const {
  getEvents,
  getBookedEvents,
  showEvent,
  updateEvent,
  postEvent,
  deleteEvent,
  confirmEvent,
  getActiveEventsNumber
} = require('../controllers/events');

const {
  GeneralGETRequestRateLimiter,
  GeneralPUTRequestRateLimiter,
  GeneralDELETERequestRateLimiter,
  GeneralPOSTRequestRateLimiter
} = require('../middlewares/rate_limiter');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');
const { event_multitenant_filter } = require('../middlewares/event-filter');
const { validateStudentId } = require('../common/validation');
// const handleError = require('../utils/eventErrors');
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

module.exports = router;
