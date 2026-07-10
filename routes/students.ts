import { Router } from 'express';
import { Role } from '@taiger-common/core';

import {
  GeneralPUTRequestRateLimiter,
  GeneralPOSTRequestRateLimiter,
  GeneralDELETERequestRateLimiter,
  GeneralGETRequestRateLimiter
} from '../middlewares/rate_limiter';
import { protect, permit } from '../middlewares/auth';
import { multitenant_filter } from '../middlewares/multitenant-filter';
import { InnerTaigerMultitenantFilter } from '../middlewares/InnerTaigerMultitenantFilter';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';
import { ProfilefileUpload, VPDfileUpload } from '../middlewares/file-upload';

import studentsController from '../controllers/students';
import filesController from '../controllers/files';
import {
  permission_canAssignEditor_filter,
  permission_canAssignAgent_filter,
  permission_canAccessStudentDatabase_filter
} from '../middlewares/permission-filter';
import { auditLog } from '../utils/log/auditLog';
import { validateStudentId, validateApplicationId } from '../common/validation';

const {
  getStudentAndDocLinks,
  updateDocumentationHelperLink,
  getStudentsAndDocLinks,
  getStudent,
  getStudentsByIds,
  updateStudentsArchivStatus,
  assignAgentToStudent,
  assignEditorToStudent,
  assignAttributesToStudent,
  getStudentsV3,
  getStudentsV3Paginated,
  getActiveStudents
} = studentsController;
const {
  saveProfileFilePath,
  updateVPDFileNecessity,
  saveVPDFilePath,
  downloadVPDFile,
  downloadProfileFileURL,
  updateProfileDocumentStatus,
  deleteProfileFile,
  deleteVPDFile,
  updateVPDPayment
} = filesController;

const router = Router();

router.use(protect);

router
  .route('/v3')
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    permission_canAccessStudentDatabase_filter,
    getStudentsV3
  );

router
  .route('/v3/paginated')
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    permission_canAccessStudentDatabase_filter,
    getStudentsV3Paginated
  );

router
  .route('/batch')
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    permission_canAccessStudentDatabase_filter,
    getStudentsByIds
  );

router
  .route('/active')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    getActiveStudents
  );

router
  .route('/doc-links')
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent),
    permission_canAccessStudentDatabase_filter,
    updateDocumentationHelperLink
  )
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    permission_canAccessStudentDatabase_filter,
    getStudentsAndDocLinks
  );

router
  .route('/doc-links/:studentId')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    permission_canAccessStudentDatabase_filter,
    validateStudentId,
    multitenant_filter,
    getStudentAndDocLinks
  );

router
  .route('/archiv/:studentId')
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    permission_canAccessStudentDatabase_filter,
    validateStudentId,
    InnerTaigerMultitenantFilter,
    updateStudentsArchivStatus
  );

router
  .route('/:studentId/agents')
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent),
    permission_canAssignAgent_filter,
    validateStudentId,
    assignAgentToStudent,
    auditLog
  );

router
  .route('/:studentId/editors')
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor),
    permission_canAssignEditor_filter,
    validateStudentId,
    assignEditorToStudent,
    auditLog
  );

router
  .route('/:studentId/attributes')
  .post(
    validateStudentId,
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent),
    InnerTaigerMultitenantFilter,
    assignAttributesToStudent
  );

router
  .route('/:studentId/vpd/:applicationId/payments')
  .post(
    validateStudentId,
    validateApplicationId,
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent),
    permission_canAccessStudentDatabase_filter,
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    updateVPDPayment
  );

router
  .route('/:studentId/vpd/:applicationId/:fileType')
  .put(
    validateApplicationId,
    validateStudentId,
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    permission_canAccessStudentDatabase_filter,
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    updateVPDFileNecessity
  )
  .get(
    validateApplicationId,
    validateStudentId,
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    permission_canAccessStudentDatabase_filter,
    multitenant_filter,
    downloadVPDFile
  )
  .post(
    validateApplicationId,
    validateStudentId,
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    permission_canAccessStudentDatabase_filter,
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    VPDfileUpload,
    saveVPDFilePath
  )
  .delete(
    validateApplicationId,
    validateStudentId,
    filter_archiv_user,
    GeneralDELETERequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Student),
    permission_canAccessStudentDatabase_filter,
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    deleteVPDFile
  );

router
  .route('/:studentId/files/:file_key')
  .get(
    validateStudentId,
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    permission_canAccessStudentDatabase_filter,
    multitenant_filter,
    downloadProfileFileURL
  );

router
  .route('/:studentId/files/:category')
  .post(
    validateStudentId,
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    permission_canAccessStudentDatabase_filter,
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    ProfilefileUpload,
    saveProfileFilePath
  )
  .delete(
    validateStudentId,
    filter_archiv_user,
    GeneralDELETERequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Student),
    permission_canAccessStudentDatabase_filter,
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    deleteProfileFile
  );

router
  .route('/:studentId/:category/status')
  .post(
    validateStudentId,
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent),
    permission_canAccessStudentDatabase_filter,
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    updateProfileDocumentStatus
  );

router
  .route('/:studentId')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    permission_canAccessStudentDatabase_filter,
    multitenant_filter,
    getStudent
  );
export = router;
