const { Router } = require('express');
const { Role } = require('@taiger-common/core');
const {
  GeneralGETRequestRateLimiter,
  GeneralPUTRequestRateLimiter,
  DownloadTemplateRateLimiter,
  RemoveNotificationRateLimiter,
  updateCredentialRateLimiter,
  updatePersonalInformationRateLimiter
} = require('../middlewares/rate_limiter');
const { filter_archiv_user } = require('../middlewares/limit_archiv_user');
const { multitenant_filter } = require('../middlewares/multitenant-filter');
const {
  InnerTaigerMultitenantFilter
} = require('../middlewares/InnerTaigerMultitenantFilter');
const { protect, permit } = require('../middlewares/auth');
const {
  TemplatefileUpload,
  admissionUpload
} = require('../middlewares/file-upload');

const {
  getTemplates,
  deleteTemplate,
  uploadTemplate,
  downloadTemplateFile,
  removeNotification,
  removeAgentNotification,
  getMyAcademicBackground,
  updateStudentApplicationResult,
  updateStudentApplicationResultV2
} = require('../controllers/files');
const {
  updateAcademicBackground,
  updateLanguageSkill,
  updateApplicationPreferenceSkill,
  updatePersonalData
} = require('../controllers/account');

const {
  updateCredentials,
  updateOfficehours
} = require('../controllers/account');
const { localAuth } = require('../middlewares/auth');
const { logAccess } = require('../utils/log/log');

const router = Router();

router.use(protect);

router
  .route('/files/template')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    getTemplates,
    logAccess
  );

router
  .route('/files/template/:category_name')
  .post(
    filter_archiv_user,
    permit(Role.Admin),
    TemplatefileUpload,
    uploadTemplate,
    logAccess
  )
  .delete(
    filter_archiv_user,
    permit(Role.Admin, Role.Manager),
    deleteTemplate,
    logAccess
  )
  .get(
    filter_archiv_user,
    DownloadTemplateRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    downloadTemplateFile,
    logAccess
  );

router
  .route('/applications/result/v2/:studentId/:programId/:admission')
  .post(
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Student),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    admissionUpload,
    updateStudentApplicationResultV2,
    logAccess
  );

router
  .route('/applications/result/:studentId/:programId/:result')
  .post(
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Student),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    admissionUpload,
    updateStudentApplicationResult,
    logAccess
  );

// Close notification for Studen
router
  .route('/student/notifications')
  .post(
    RemoveNotificationRateLimiter,
    permit(
      Role.Admin,
      Role.Manager,
      Role.Agent,
      Role.Editor,
      Role.Student,
      Role.Guest
    ),
    removeNotification,
    logAccess
  );

// Close notification for Agent
router
  .route('/agent/notifications')
  .post(
    filter_archiv_user,
    RemoveNotificationRateLimiter,
    permit(Role.Agent),
    removeAgentNotification,
    logAccess
  );

// My Profile for Students
router
  .route('/survey')
  .get(
    updatePersonalInformationRateLimiter,
    permit(Role.Admin, Role.Agent, Role.Editor, Role.Student, Role.Guest),
    getMyAcademicBackground,
    logAccess
  );

router
  .route('/survey/university/:studentId')
  .post(
    filter_archiv_user,
    updatePersonalInformationRateLimiter,
    permit(
      Role.Admin,
      Role.Manager,
      Role.Agent,
      Role.Editor,
      Role.Student,
      Role.Guest
    ),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    updateAcademicBackground,
    logAccess
  );

router
  .route('/survey/language/:studentId')
  .post(
    filter_archiv_user,
    updatePersonalInformationRateLimiter,
    permit(
      Role.Admin,
      Role.Manager,
      Role.Agent,
      Role.Editor,
      Role.Student,
      Role.Guest
    ),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    updateLanguageSkill,
    logAccess
  );

router
  .route('/survey/preferences/:studentId')
  .post(
    filter_archiv_user,
    updatePersonalInformationRateLimiter,
    permit(
      Role.Admin,
      Role.Manager,
      Role.Agent,
      Role.Editor,
      Role.Student,
      Role.Guest
    ),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    updateApplicationPreferenceSkill,
    logAccess
  );

router
  .route('/profile/officehours/:user_id')
  .put(
    filter_archiv_user,
    updatePersonalInformationRateLimiter,
    permit(Role.Admin, Role.Agent),
    updateOfficehours,
    logAccess
  );

router
  .route('/profile/:user_id')
  .post(
    filter_archiv_user,
    updatePersonalInformationRateLimiter,
    permit(
      Role.Admin,
      Role.Manager,
      Role.Agent,
      Role.Editor,
      Role.Student,
      Role.Guest
    ),
    updatePersonalData,
    logAccess
  );

router
  .route('/credentials')
  .post(
    updateCredentialRateLimiter,
    permit(
      Role.Admin,
      Role.Manager,
      Role.Agent,
      Role.Editor,
      Role.Student,
      Role.Guest
    ),
    localAuth,
    updateCredentials,
    logAccess
  );

module.exports = router;
