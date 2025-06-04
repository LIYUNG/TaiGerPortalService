const { Router } = require('express');
const { Role } = require('@taiger-common/core');
const { GeneralGETRequestRateLimiter } = require('../middlewares/rate_limiter');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');

const { protect, permit } = require('../middlewares/auth');
const { getAgentProfile, putAgentProfile } = require('../controllers/teams');

const router = Router();

router.use(protect);

router
  .route('/profile/:agent_id')
  .put(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent),
    putAgentProfile
  )
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    getAgentProfile
  );

module.exports = router;
