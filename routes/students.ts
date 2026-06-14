const { Router } = require('express');
const { Role } = require('@taiger-common/core');

const {
  GeneralPUTRequestRateLimiter,
  GeneralPOSTRequestRateLimiter,
  GeneralDELETERequestRateLimiter,
  GeneralGETRequestRateLimiter
} = require('../middlewares/rate_limiter');
const { protect, permit } = require('../middlewares/auth');
const { multitenant_filter } = require('../middlewares/multitenant-filter');
const {
  InnerTaigerMultitenantFilter
} = require('../middlewares/InnerTaigerMultitenantFilter');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');
const {
  ProfilefileUpload,
  VPDfileUpload
} = require('../middlewares/file-upload');

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
} = require('../controllers/students');
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
} = require('../controllers/files');
const {
  permission_canAssignEditor_filter,
  permission_canAssignAgent_filter,
  permission_canAccessStudentDatabase_filter
} = require('../middlewares/permission-filter');
const { auditLog } = require('../utils/log/auditLog');
const {
  validateStudentId,
  validateProgramId,
  validateApplicationId
} = require('../common/validation');

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
module.exports = router;
