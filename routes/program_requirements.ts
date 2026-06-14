const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const {
  GeneralPOSTRequestRateLimiter,
  GeneralGETRequestRateLimiter,
  GeneralPUTRequestRateLimiter,
  GeneralDELETERequestRateLimiter
} = require('../middlewares/rate_limiter');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');
const { protect, permit } = require('../middlewares/auth');
const {
  getProgramRequirements,
  getProgramRequirement,
  createProgramRequirement,
  updateProgramRequirement,
  deleteProgramRequirement,
  getDistinctProgramsAndKeywordSets
} = require('../controllers/program_requirements');

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

module.exports = router;
