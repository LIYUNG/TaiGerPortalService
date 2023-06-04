const { Router } = require('express');
const { GeneralGETRequestRateLimiter } = require('../middlewares/rate_limiter');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');
const { protect, permit } = require('../middlewares/auth');
const { Role } = require('../models/User');
const { getEditors } = require('../controllers/teams');
const { permission_canAssignEditor_filter } = require('../middlewares/permission-filter');

const router = Router();

router.use(protect, permit(Role.Admin, Role.Manager, Role.Editor));

router
  .route('/')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permission_canAssignEditor_filter,
    getEditors
  );

module.exports = router;
