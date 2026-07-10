import { Router } from 'express';
import { Role } from '@taiger-common/core';

import {
  GeneralPOSTRequestRateLimiter,
  GeneralDELETERequestRateLimiter,
  GeneralGETRequestRateLimiter
} from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';

import usersController from '../controllers/users';
import { auditLog } from '../utils/log/auditLog';
import { permission_canAddUser_filter } from '../middlewares/permission-filter';

const {
  getUsers,
  updateUserArchivStatus,
  addUser,
  updateUser,
  deleteUser,
  getUser,
  getUsersCount,
  getUsersOverview
} = usersController;

const router = Router();

router.use(protect, permit(Role.Admin, Role.Agent, Role.Editor));

router
  .route('/overview')
  .get(
    filter_archiv_user,
    permit(Role.Admin, Role.Agent, Role.Editor),
    GeneralGETRequestRateLimiter,
    getUsersOverview
  );

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

export = router;
