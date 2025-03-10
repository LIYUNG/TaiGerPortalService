const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const {
  GeneralPOSTRequestRateLimiter,
  GeneralGETRequestRateLimiter
} = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');

const {
  WidgetProcessTranscript,
  WidgetdownloadXLSX,
  WidgetExportMessagePDF,
  WidgetProcessTranscriptV2,
  WidgetdownloadJson
} = require('../controllers/widget');

const router = Router();

router.use(protect);

router
  .route('/messages/export/:studentId')
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent),
    WidgetExportMessagePDF
  );

router
  .route('/transcript/engine/v2/:language')
  .post(
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.External),
    WidgetProcessTranscriptV2
  );

router
  .route('/transcript/:category/:language')
  .post(
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.External),
    WidgetProcessTranscript
  );

router
  .route('/transcript/v2/:adminId')
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.External),
    WidgetdownloadJson
  );

router
  .route('/transcript/:adminId')
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.External),
    WidgetdownloadXLSX
  );

module.exports = router;
