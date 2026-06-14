import { Router } from 'express';
import { Role } from '@taiger-common/core';

import {
  GeneralGETRequestRateLimiter,
  GeneralPUTRequestRateLimiter,
  TranscriptAnalyserRateLimiter,
  DownloadTemplateRateLimiter,
  GeneralDELETERequestRateLimiter
} from '../middlewares/rate_limiter';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';
import { multitenant_filter } from '../middlewares/multitenant-filter';
import { InnerTaigerMultitenantFilter } from '../middlewares/InnerTaigerMultitenantFilter';
import { protect, permit, prohibit } from '../middlewares/auth';
import {
  getMycourses,
  putMycourses,
  processTranscript_api_gatway,
  downloadJson,
  deleteMyCourse
} from '../controllers/course';
import { validateStudentId } from '../common/validation';

const router = Router();

router.use(protect);

// TaiGer Transcript Analyser (Python Backend)
router.route('/transcript/test').get(
  filter_archiv_user,
  TranscriptAnalyserRateLimiter,
  permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
  multitenant_filter,
  // InnerTaigerMultitenantFilter,
  processTranscript_api_gatway
);

router
  .route('/:studentId')
  .put(
    validateStudentId,
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Student, Role.Guest),
    multitenant_filter,
    putMycourses
  )
  .get(
    validateStudentId,
    GeneralGETRequestRateLimiter,
    prohibit(Role.Guest),
    multitenant_filter,
    getMycourses
  )
  .delete(
    validateStudentId,
    GeneralDELETERequestRateLimiter,
    prohibit(Role.Guest),
    multitenant_filter,
    deleteMyCourse
  );

// TaiGer Transcript Analyser:
router
  .route('/transcript/v2/:studentId/:language')
  .post(
    filter_archiv_user,
    TranscriptAnalyserRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    processTranscript_api_gatway
  );

router
  .route('/transcript/v2/:studentId')
  .get(
    filter_archiv_user,
    DownloadTemplateRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    multitenant_filter,
    downloadJson
  );

module.exports = router;
