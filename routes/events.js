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
const { logAccess } = require('../utils/log/log');
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
    getBookedEvents,
    logAccess
  );

router
  .route('/')
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    getEvents,
    logAccess
  )
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    // TODO: prevent student change receiver_id!
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    postEvent,
    logAccess
  );

router
  .route('/:studentId/show')
  .get(
    validateStudentId,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    showEvent,
    logAccess
  );

router
  .route('/:event_id/confirm')
  .put(
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    event_multitenant_filter,
    confirmEvent,
    logAccess
  );

router
  .route('/:event_id')
  .put(
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    event_multitenant_filter,
    updateEvent,
    logAccess
  )
  .delete(
    filter_archiv_user,
    GeneralDELETERequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    event_multitenant_filter,
    deleteEvent
  );

module.exports = router;
