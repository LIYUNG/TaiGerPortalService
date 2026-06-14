const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const {
  GeneralPOSTRequestRateLimiter,
  GeneralGETRequestRateLimiter
} = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');
const {
  updateUserPermission,
  getUserPermission
} = require('../controllers/permissions');

const router = Router();

router.use(protect, permit(Role.Admin));

router
  .route('/:user_id')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getUserPermission)
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    updateUserPermission
  );

module.exports = router;
