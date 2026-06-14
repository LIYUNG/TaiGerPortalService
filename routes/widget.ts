import { Router } from 'express';
import { Role } from '@taiger-common/core';

import {
  GeneralPOSTRequestRateLimiter,
  GeneralGETRequestRateLimiter
} from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';

import {
  WidgetExportMessagePDF,
  WidgetProcessTranscriptV2,
  WidgetdownloadJson
} from '../controllers/widget';

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
  .route('/transcript/v2/:adminId')
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.External),
    WidgetdownloadJson
  );

module.exports = router;
