const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const { GeneralGETRequestRateLimiter } = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');
const { getExpenses, getExpense } = require('../controllers/expenses');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');

const router = Router();
router.use(protect);

router
  .route('/')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getExpenses
  );
router
  .route('/users/:taiger_user_id')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getExpense
  );

module.exports = router;
