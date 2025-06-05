const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const {
  GeneralGETRequestRateLimiter,
  getMessagesRateLimiter,
  postMessagesImageRateLimiter,
  GeneralPUTRequestRateLimiter
} = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');

const {
  getStudentApplications,
  deleteApplication,
  createApplicationV2,
  getMyStudentsApplications,
  updateStudentApplications
} = require('../controllers/applications');
const { multitenant_filter } = require('../middlewares/multitenant-filter');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');
const {
  InnerTaigerMultitenantFilter
} = require('../middlewares/InnerTaigerMultitenantFilter');
const { logAccess } = require('../utils/log/log');

const router = Router();

router.use(protect);

router.route('/application/:application_id').delete(
  getMessagesRateLimiter,
  permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor), // TODO: Add multitenant_filter?
  deleteApplication
);

router
  .route('/taiger-user/:userId')
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getMyStudentsApplications
  );

router
  .route('/student/:studentId')
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getStudentApplications
  )
  .put(
    // TODO: not implemented yet (UI dependent!)
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Student),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    updateStudentApplications,
    logAccess
  )
  .post(
    filter_archiv_user,
    postMessagesImageRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    multitenant_filter,
    createApplicationV2
  );

module.exports = router;
