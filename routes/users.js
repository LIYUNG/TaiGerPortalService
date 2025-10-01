const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const {
  GeneralPUTRequestRateLimiter,
  GeneralPOSTRequestRateLimiter,
  GeneralDELETERequestRateLimiter,
  GeneralGETRequestRateLimiter
} = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');

const {
  getUsers,
  updateUserArchivStatus,
  addUser,
  updateUser,
  deleteUser,
  getUser,
  getUsersCount
} = require('../controllers/users');
const { auditLog } = require('../utils/log/auditLog');
const {
  permission_canAddUser_filter
} = require('../middlewares/permission-filter');

const router = Router();

router.use(protect, permit(Role.Admin, Role.Agent, Role.Editor));

router
  .route('/')
  .get(
    filter_archiv_user,
    permit(Role.Admin, Role.Agent, Role.Editor),
    GeneralGETRequestRateLimiter,
    getUsers
  )
  .post(
    filter_archiv_user,
    permit(Role.Admin, Role.Agent, Role.Editor),
    GeneralPOSTRequestRateLimiter,
    permission_canAddUser_filter,
    addUser,
    auditLog
  );

router
  .route('/count')
  .get(
    filter_archiv_user,
    permit(Role.Admin, Role.Agent, Role.Editor),
    GeneralGETRequestRateLimiter,
    getUsersCount
  );

router
  .route('/:user_id')
  .post(
    filter_archiv_user,
    permit(Role.Admin),
    GeneralPOSTRequestRateLimiter,
    updateUser
  )
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getUser)
  .delete(
    filter_archiv_user,
    permit(Role.Admin),
    GeneralDELETERequestRateLimiter,
    deleteUser
  );
router
  .route('/archiv/:user_id')
  .post(
    filter_archiv_user,
    permit(Role.Admin),
    GeneralPOSTRequestRateLimiter,
    updateUserArchivStatus
  );

module.exports = router;
