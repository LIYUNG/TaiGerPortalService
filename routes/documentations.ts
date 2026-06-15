import { Router } from 'express';
import { Role } from '@taiger-common/core';
import {
  GeneralPUTRequestRateLimiter,
  GeneralPOSTRequestRateLimiter,
  GeneralDELETERequestRateLimiter,
  DocumentationGETRateLimiter
} from '../middlewares/rate_limiter';
import {
  imageUpload,
  documentationDocsUpload
} from '../middlewares/file-upload';
import { filter_archiv_user } from '../middlewares/limit_archiv_user';
import { protect, permit, prohibit } from '../middlewares/auth';

import {
  getInternalDocumentationsPage,
  updateInternalDocumentationPage,
  updateDocumentationPage,
  getCategoryDocumentationsPage,
  getAllDocumentations,
  getAllInternalDocumentations,
  getDocumentation,
  getInternalDocumentation,
  createDocumentation,
  createInternalDocumentation,
  uploadDocImage,
  getDocFile,
  uploadDocDocs,
  updateDocumentation,
  updateInternalDocumentation,
  deleteDocumentation,
  deleteInternalDocumentation
} from '../controllers/documentations';

import { permission_canModifyDocs_filter } from '../middlewares/permission-filter';

const router = Router();

router.use(protect);

router
  .route('/')
  .post(
    filter_archiv_user,
    permit(Role.Admin, Role.Agent),
    permission_canModifyDocs_filter,
    createDocumentation
  );

// Internal Docs
router
  .route('/internal')
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent),
    permission_canModifyDocs_filter,
    createInternalDocumentation
  );
router
  .route('/internal/all')
  .get(
    filter_archiv_user,
    DocumentationGETRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent),
    getAllInternalDocumentations
  );
router
  .route('/internal/search/:doc_id')
  .get(
    filter_archiv_user,
    DocumentationGETRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent),
    getInternalDocumentation
  );
router
  .route('/internal/:id')
  .put(
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent),
    permission_canModifyDocs_filter,
    updateInternalDocumentation
  )
  .delete(
    filter_archiv_user,
    GeneralDELETERequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent),
    permission_canModifyDocs_filter,
    deleteInternalDocumentation
  );

router
  .route('/taiger/internal/confidential')
  .get(
    filter_archiv_user,
    DocumentationGETRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent),
    permission_canModifyDocs_filter,
    getInternalDocumentationsPage
  )
  .put(
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Editor, Role.Agent),
    permission_canModifyDocs_filter,
    updateInternalDocumentationPage
  );

router
  .route('/upload/image')
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent),
    permission_canModifyDocs_filter,
    imageUpload,
    uploadDocImage
  );
router
  .route('/file/:object_key')
  .get(
    filter_archiv_user,
    DocumentationGETRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent, Role.Editor, Role.Student),
    getDocFile
  );

router
  .route('/upload/docs')
  .post(
    filter_archiv_user,
    GeneralPOSTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent),
    permission_canModifyDocs_filter,
    documentationDocsUpload,
    uploadDocDocs
  );

router
  .route('/pages/:category')
  .get(
    filter_archiv_user,
    DocumentationGETRateLimiter,
    prohibit(Role.Guest),
    getCategoryDocumentationsPage
  )
  .put(
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    prohibit(Role.Guest),
    permission_canModifyDocs_filter,
    updateDocumentationPage
  );

router
  .route('/all')
  .get(
    filter_archiv_user,
    DocumentationGETRateLimiter,
    prohibit(Role.Guest),
    getAllDocumentations
  );
router
  .route('/search/:doc_id')
  .get(
    filter_archiv_user,
    DocumentationGETRateLimiter,
    prohibit(Role.Guest),
    getDocumentation
  );

router
  .route('/:id')
  .put(
    filter_archiv_user,
    GeneralPUTRequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent),
    permission_canModifyDocs_filter,
    updateDocumentation
  )
  .delete(
    filter_archiv_user,
    GeneralDELETERequestRateLimiter,
    permit(Role.Admin, Role.Manager, Role.Agent),
    permission_canModifyDocs_filter,
    deleteDocumentation
  );

export = router;
