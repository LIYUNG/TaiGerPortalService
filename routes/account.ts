import { Router } from 'express';
import { Role } from '@taiger-common/core';
import {
  GeneralGETRequestRateLimiter,
  GeneralPUTRequestRateLimiter,
  DownloadTemplateRateLimiter,
  RemoveNotificationRateLimiter,
  updateCredentialRateLimiter,
  updatePersonalInformationRateLimiter
} from '../middlewares/rate_limiter';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';
import { multitenant_filter } from '../middlewares/multitenant-filter';
import { InnerTaigerMultitenantFilter } from '../middlewares/InnerTaigerMultitenantFilter';
import { protect, permit, localAuth } from '../middlewares/auth';
import {
  TemplatefileUpload,
  admissionUpload
} from '../middlewares/file-upload';

import {
  getTemplates,
  deleteTemplate,
  uploadTemplate,
  downloadTemplateFile,
  removeNotification,
  removeAgentNotification,
  getMyAcademicBackground,
  updateStudentApplicationResult,
  updateStudentApplicationResultV2
} from '../controllers/files';
import {
  updateAcademicBackground,
  updateLanguageSkill,
  updateApplicationPreferenceSkill,
  updatePersonalData,
  updateCredentials,
  updateOfficehours
} from '../controllers/account';

import { validateStudentId } from '../common/validation';

const router = Router();

router.use(protect);

router
  .route('/files/template')
  .get(
    filter_archiv_user,
    GeneralGETRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    getTemplates
  );

router
  .route('/files/template/:category_name')
  .post(
    filter_archiv_user,
    permit(Role.Admin),
    TemplatefileUpload,
    uploadTemplate
  )
  .delete(filter_archiv_user, permit(Role.Admin, Role.Manager), deleteTemplate)
  .get(
    filter_archiv_user,
    DownloadTemplateRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    downloadTemplateFile
  );

router
  .route('/applications/result/v2/:studentId/:programId/:admission')
  .post(
    validateStudentId,
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Student),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    admissionUpload,
    updateStudentApplicationResultV2
  );

router
  .route('/applications/result/:studentId/:applicationId/:programId/:result')
  .post(
    validateStudentId,
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Student),
    multitenant_filter,
    InnerTaigerMultitenantFilter,
    admissionUpload,
    updateStudentApplicationResult
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
    removeNotification
  );

// Close notification for Agent
router
  .route('/agent/notifications')
  .post(
    filter_archiv_user,
    RemoveNotificationRateLimiter,
    permit(Role.Agent),
    removeAgentNotification
  );

// My Profile for Students
router
  .route('/survey')
  .get(
    updatePersonalInformationRateLimiter,
    permit(Role.Admin, Role.Agent, Role.Editor, Role.Student, Role.Guest),
    getMyAcademicBackground
  );

router
  .route('/survey/university/:studentId')
  .post(
    validateStudentId,
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
    updateAcademicBackground
  );

router
  .route('/survey/language/:studentId')
  .post(
    validateStudentId,
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
    updateLanguageSkill
  );

router
  .route('/survey/preferences/:studentId')
  .post(
    validateStudentId,
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
    updateApplicationPreferenceSkill
  );

router
  .route('/profile/officehours/:user_id')
  .put(
    filter_archiv_user,
    updatePersonalInformationRateLimiter,
    permit(Role.Agent, Role.Editor),
    updateOfficehours
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
    updatePersonalData
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
    updateCredentials
  );

export = router;
