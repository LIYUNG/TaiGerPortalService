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
  getStudents,
  getAllStudents,
  updateStudentsArchivStatus,
  assignAgentToStudent,
  assignEditorToStudent,
  createApplication,
  ToggleProgramStatus,
  getAllActiveStudents,
  assignAttributesToStudent,
  getStudentsV3
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
const { logAccess } = require('../utils/log/log');
const { auditLog } = require('../utils/log/auditLog');
const { validateStudentId } = require('../common/validation');

const router = Router();

router.use(protect);

router
  .route('/')
  .get(
    GeneralGETRequestRateLimiter,
    permit(
      Role.Admin,
      Role.Manager,
      Role.Agent,
      Role.Editor,
      Role.Student,
      Role.External,
      Role.Guest
    ),
    permission_canAccessStudentDatabase_filter,
    getStudents,
    logAccess
  );

router
  .route('/v3')
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    permission_canAccessStudentDatabase_filter,
    getStudentsV3,
    logAccess
  );

router
  .route('/all/active')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    permission_canAccessStudentDatabase_filter,
    getAllActiveStudents,
    logAccess
  );

router
  .route('/all')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor),
    permission_canAccessStudentDatabase_filter,
    getAllStudents,
    logAccess
  );

router
  .route('/doc-links')
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent),
    permission_canAccessStudentDatabase_filter,
    updateDocumentationHelperLink,
    logAccess
  )
  .get(
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    permission_canAccessStudentDatabase_filter,
    getStudentsAndDocLinks,
    logAccess
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
    getStudentAndDocLinks,
    logAccess
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
    updateStudentsArchivStatus,
    logAccess
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
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent),
    InnerTaigerMultitenantFilter,
    validateStudentId,
    assignAttributesToStudent,
    logAccess
  );

router
  .route('/:studentId/applications')
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent),
    permission_canAccessStudentDatabase_filter,
    validateStudentId,
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    createApplication,
    logAccess
  );

router
  .route('/:studentId/:program_id')
  .put(
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Student),
    permission_canAccessStudentDatabase_filter,
    validateStudentId,
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    ToggleProgramStatus,
    logAccess
  );

router
  .route('/:studentId/vpd/:program_id/payments')
  .post(
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent),
    permission_canAccessStudentDatabase_filter,
    validateStudentId,
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    updateVPDPayment,
    logAccess
  );

router
  .route('/:studentId/vpd/:program_id/:fileType')
  .put(
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    permission_canAccessStudentDatabase_filter,
    validateStudentId,
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    updateVPDFileNecessity,
    logAccess
  )
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    permission_canAccessStudentDatabase_filter,
    validateStudentId,
    multitenant_filter,
    downloadVPDFile,
    logAccess
  )
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    permission_canAccessStudentDatabase_filter,
    validateStudentId,
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    VPDfileUpload,
    saveVPDFilePath,
    logAccess
  )
  .delete(
    filter_archiv_user,
    GeneralDELETERequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Student),
    permission_canAccessStudentDatabase_filter,
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    deleteVPDFile,
    logAccess
  );

router
  .route('/:studentId/files/:file_key')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    permission_canAccessStudentDatabase_filter,
    validateStudentId,
    multitenant_filter,
    downloadProfileFileURL,
    logAccess
  );

router
  .route('/:studentId/files/:category')
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent, Role.Student),
    permission_canAccessStudentDatabase_filter,
    validateStudentId,
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    ProfilefileUpload,
    saveProfileFilePath,
    logAccess
  )
  .delete(
    filter_archiv_user,
    GeneralDELETERequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Student),
    permission_canAccessStudentDatabase_filter,
    validateStudentId,
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    deleteProfileFile,
    logAccess
  );

router
  .route('/:studentId/:category/status')
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent),
    permission_canAccessStudentDatabase_filter,
    validateStudentId,
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    updateProfileDocumentStatus,
    logAccess
  );
module.exports = router;
