import { Router } from 'express';
import { Role } from '@taiger-common/core';

import { GeneralGETRequestRateLimiter } from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';
import expensesController from '../controllers/expenses';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';

const { getExpenses, getExpense } = expensesController;

const router = Router();
router.use(GeneralGETRequestRateLimiter);
router.use(protect);

router
  .route('/')
  .get(
    filter_archiv_user,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getExpenses
  );
router
  .route('/users/:taiger_user_id')
  .get(
    filter_archiv_user,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getExpense
  );

export = router;
