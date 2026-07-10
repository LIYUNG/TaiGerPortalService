import { Router } from 'express';
import { Role } from '@taiger-common/core';

import {
  GeneralPOSTRequestRateLimiter,
  GeneralGETRequestRateLimiter,
  GeneralPUTRequestRateLimiter,
  GeneralDELETERequestRateLimiter
} from '../middlewares/rate_limiter';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';
import { protect, permit } from '../middlewares/auth';
import programRequirementsController from '../controllers/program_requirements';

const {
  getProgramRequirements,
  getProgramRequirement,
  createProgramRequirement,
  updateProgramRequirement,
  deleteProgramRequirement,
  getDistinctProgramsAndKeywordSets
} = programRequirementsController;

const router = Router();

router.use(protect);

router
  .route('/')
  .get(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.External),
    getProgramRequirements
  );

router
  .route('/new')
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.External),
    createProgramRequirement
  );

router
  .route('/programs-and-keywords')
  .get(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.External),
    getDistinctProgramsAndKeywordSets
  );

router
  .route('/:requirementId')
  .put(
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.External),
    updateProgramRequirement
  )
  .delete(
    GeneralDELETERequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.External),
    deleteProgramRequirement
  )
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.External),
    getProgramRequirement
  );

export = router;
