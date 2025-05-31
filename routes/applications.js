const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const {
  GeneralGETRequestRateLimiter,
  getMessagesRateLimiter,
  postMessagesImageRateLimiter
} = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');

const {
  getStudentApplications,
  deleteApplication,
  createApplicationV2
} = require('../controllers/applications');
const { multitenant_filter } = require('../middlewares/multitenant-filter');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');

const router = Router();

router.use(protect);

router
  .route('/application/:application_id')
  .delete(
    getMessagesRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    deleteApplication
  );

router
  .route('/student/:studentId')
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getStudentApplications
  )
  .post(
    filter_archiv_user,
    postMessagesImageRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    multitenant_filter,
    createApplicationV2
  );

module.exports = router;
