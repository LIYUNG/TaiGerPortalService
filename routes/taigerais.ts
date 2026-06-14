const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const { GeneralGETRequestRateLimiter } = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');
const {
  processProgramListAi,
  cvmlrlAi,
  TaiGerAiChat
} = require('../controllers/taigerais');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');
const {
  permission_canModifyProgramList_filter,
  permission_canUseTaiGerAI_filter,
  permission_TaiGerAIRatelimiter
} = require('../middlewares/permission-filter');
const {
  chatMultitenantFilter
} = require('../middlewares/chatMultitenantFilter');

const router = Router();
router.use(protect);

router
  .route('/chat/:studentId')
  .post(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    chatMultitenantFilter,
    permission_canUseTaiGerAI_filter,
    permission_TaiGerAIRatelimiter,
    TaiGerAiChat
  );

router
  .route('/cvmlrl')
  .post(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    permission_canUseTaiGerAI_filter,
    permission_TaiGerAIRatelimiter,
    cvmlrlAi
  );

router
  .route('/program/:programId')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    permission_canModifyProgramList_filter,
    permission_canUseTaiGerAI_filter,
    permission_TaiGerAIRatelimiter,
    processProgramListAi
  );

module.exports = router;
