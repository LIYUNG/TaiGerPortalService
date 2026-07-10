import { Router } from 'express';
import { Role } from '@taiger-common/core';

import { GeneralGETRequestRateLimiter } from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';

import teamsController from '../controllers/teams';
import { permission_canAccessStudentDatabase_filter } from '../middlewares/permission-filter';

const {
  getTeamMembers,
  getStatisticsOverview,
  getStatisticsAgents,
  getStatisticsKPI,
  getStatisticsResponseTime,
  getResponseIntervalByStudent,
  getResponseTimeByStudent,
  getArchivStudents,
  getTasksOverview,
  getIsManager
} = teamsController;

const router = Router();

router.use(protect, permit(Role.Admin, Role.Agent, Role.Editor));

router
  .route('/')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getTeamMembers);

router
  .route('/statistics/overview')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permission_canAccessStudentDatabase_filter,
    getStatisticsOverview
  );

router
  .route('/statistics/agents')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permission_canAccessStudentDatabase_filter,
    getStatisticsAgents
  );

router
  .route('/statistics/kpi')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permission_canAccessStudentDatabase_filter,
    getStatisticsKPI
  );

router
  .route('/statistics/response-time')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permission_canAccessStudentDatabase_filter,
    getStatisticsResponseTime
  );

router
  .route('/is-manager')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Agent, Role.Editor),
    getIsManager
  );

router
  .route('/tasks-overview')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getTasksOverview
  );

router
  .route('/response-interval/:studentId')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permission_canAccessStudentDatabase_filter,
    getResponseIntervalByStudent
  );

router
  .route('/')
  .get(filter_archiv_user, GeneralGETRequestRateLimiter, getTeamMembers);
router
  .route('/response-time/:studentId')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permission_canAccessStudentDatabase_filter,
    getResponseTimeByStudent
  );

router
  .route('/archiv/:TaiGerStaffId')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Agent, Role.Editor),
    permission_canAccessStudentDatabase_filter,
    getArchivStudents
  );

export = router;
