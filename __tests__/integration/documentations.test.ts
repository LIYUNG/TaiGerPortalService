// Integration test for the documentations routes — HTTP boundary down to the
// service, with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/documentations
//   -> real DocumentationService -> MOCKED DocumentationDAO / InternaldocDAO /
//   DocspageDAO.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return. The actual DB
// query construction is covered by the DAO unit tests. Fully deterministic — no
// engine flake.

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

// The standard passthrough middleware mocks come from one shared helper (see
// __tests__/helpers/middlewareMocks). require() keeps them compatible with
// ts-jest's jest.mock hoisting.
jest.mock('../../middlewares/tenantMiddleware', () =>
  require('../helpers/middlewareMocks').tenantMiddlewareMock()
);
jest.mock('../../middlewares/decryptCookieMiddleware', () =>
  require('../helpers/middlewareMocks').decryptCookieMiddlewareMock()
);
// This file also stubs `prohibit`, which authMock() doesn't cover by default.
jest.mock('../../middlewares/auth', () => {
  const mw = require('../helpers/middlewareMocks');
  return mw.authMock({ prohibit: jest.fn(() => mw.passthrough) });
});
jest.mock('../../middlewares/limit_archiv_user', () =>
  require('../helpers/middlewareMocks').limitArchivUserMock()
);
// This file stubs `permission_canModifyDocs_filter`, which
// permissionFilterMock() doesn't cover by default.
jest.mock('../../middlewares/permission-filter', () => {
  const mw = require('../helpers/middlewareMocks');
  return mw.permissionFilterMock({
    permission_canModifyDocs_filter: mw.passthroughFn()
  });
});

jest.mock('../../middlewares/file-upload', () => {
  // Do NOT use jest.requireActual here — loading the real file-upload.js calls
  // multerS3({ s3: s3Client }) at module evaluation time which crashes in tests.
  const passthrough = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    req.files = [];
    next();
  };
  const passthroughSingle = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    req.file = undefined;
    next();
  };
  return {
    imageUpload: passthroughSingle,
    admissionUpload: passthroughSingle,
    documentationDocsUpload: passthroughSingle,
    VPDfileUpload: passthrough,
    ProfilefileUpload: passthrough,
    TemplatefileUpload: passthroughSingle,
    MessagesThreadUpload: passthrough,
    MessagesTicketUpload: passthrough,
    MessagesChatUpload: passthrough,
    MessagesImageThreadUpload: passthroughSingle,
    upload: passthroughSingle
  };
});

// The data boundary: mock the DAOs the documentation service delegates to.
jest.mock('../../dao/documentation.dao');
jest.mock('../../dao/internaldoc.dao');
jest.mock('../../dao/docspage.dao');

import DocumentationDAOModule from '../../dao/documentation.dao';
import InternaldocDAOModule from '../../dao/internaldoc.dao';
import { protect } from '../../middlewares/auth';
import { app } from '../../app';
import { TENANT_ID } from '../fixtures/constants';
import { admin } from '../mock/user';

// The DAOs are auto-mocked above; re-type each as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const DocumentationDAO = DocumentationDAOModule as unknown as MockedDAO;
const InternaldocDAO = InternaldocDAOModule as unknown as MockedDAO;

const requestWithSupertest = request(app);

beforeEach(() => {
  jest.clearAllMocks();
  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = admin;
      next();
    }
  );
});

describe('/api/docs/:category', () => {
  const article = {
    name: 'article.name',
    title: 'article.title',
    text: 'article.text',
    updatedAt: new Date().toString(),
    country: 'article.updatedAt'
  };
  const Newarticle = {
    name: 'article.name',
    title: 'Newarticle.title',
    text: 'Newarticle.text',
    updatedAt: new Date().toString(),
    country: 'article.updatedAt'
  };

  test('POST creates a documentation via the DAO and returns its fields', async () => {
    DocumentationDAO.create.mockResolvedValue({
      _id: 'doc-1',
      ...article
    });

    const resp = await requestWithSupertest
      .post('/api/docs')
      .set('tenantId', TENANT_ID)
      .send(article);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(DocumentationDAO.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: article.title, text: article.text })
    );
    const new_article = resp.body.data;
    expect(new_article.title).toBe(article.title);
    expect(new_article.text).toBe(article.text);
    expect(new_article._id).toBeDefined();
  });

  test('PUT updates a documentation (201) with the new fields via the DAO', async () => {
    const article_id = 'doc-1';
    DocumentationDAO.updateById.mockResolvedValue({
      _id: article_id,
      ...Newarticle
    });

    const resp = await requestWithSupertest
      .put(`/api/docs/${article_id}`)
      .set('tenantId', TENANT_ID)
      .send(Newarticle);

    expect(resp.status).toBe(201);
    expect(resp.body.success).toBe(true);
    expect(DocumentationDAO.updateById).toHaveBeenCalledWith(
      article_id,
      expect.objectContaining({ title: Newarticle.title })
    );
    expect(resp.body.data.title).toBe(Newarticle.title);
    expect(resp.body.data.text).toBe(Newarticle.text);
  });

  test('GET all documentations returns a success array', async () => {
    DocumentationDAO.findAllTitleCategory.mockResolvedValue([]);

    const resp = await requestWithSupertest
      .get('/api/docs/all')
      .set('tenantId', TENANT_ID);
    expect(resp.body.success).toBe(true);
    expect(DocumentationDAO.findAllTitleCategory).toHaveBeenCalled();
    expect(Array.isArray(resp.body.data)).toBe(true);
  });

  test('GET all internal documentations returns a success array', async () => {
    InternaldocDAO.findAllTitleInternalCategory.mockResolvedValue([]);

    const resp = await requestWithSupertest
      .get('/api/docs/internal/all')
      .set('tenantId', TENANT_ID);
    expect(resp.body.success).toBe(true);
    expect(InternaldocDAO.findAllTitleInternalCategory).toHaveBeenCalled();
    expect(Array.isArray(resp.body.data)).toBe(true);
  });

  test('DELETE removes a documentation via the DAO (200)', async () => {
    const article_id = 'doc-1';
    DocumentationDAO.deleteById.mockResolvedValue({ _id: article_id });

    const resp = await requestWithSupertest
      .delete(`/api/docs/${article_id}`)
      .set('tenantId', TENANT_ID);
    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(DocumentationDAO.deleteById).toHaveBeenCalledWith(article_id);
  });
});

describe('/api/docs/internal CRUD', () => {
  const internaldoc_id = 'internal-1';

  test('POST /api/docs/internal creates an internal doc (200)', async () => {
    const payload = {
      name: 'new.internal.name',
      title: 'new.internal.title',
      text: 'new.internal.text',
      category: 'internal',
      internal: true
    };
    InternaldocDAO.create.mockResolvedValue({
      _id: internaldoc_id,
      ...payload
    });

    const resp = await requestWithSupertest
      .post('/api/docs/internal')
      .set('tenantId', TENANT_ID)
      .send(payload);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(InternaldocDAO.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: payload.title })
    );
    expect(resp.body.data.title).toBe(payload.title);
  });

  test('PUT /api/docs/internal/:id updates an internal doc (201)', async () => {
    const payload = {
      title: 'updated.internal.title',
      text: 'updated.internal.text'
    };
    InternaldocDAO.updateById.mockResolvedValue({
      _id: internaldoc_id,
      ...payload
    });

    const resp = await requestWithSupertest
      .put(`/api/docs/internal/${internaldoc_id}`)
      .set('tenantId', TENANT_ID)
      .send(payload);

    expect(resp.status).toBe(201);
    expect(resp.body.success).toBe(true);
    expect(InternaldocDAO.updateById).toHaveBeenCalledWith(
      internaldoc_id,
      expect.objectContaining({ title: payload.title })
    );
    expect(resp.body.data.title).toBe(payload.title);
  });

  test('DELETE /api/docs/internal/:id deletes an internal doc (200)', async () => {
    InternaldocDAO.deleteById.mockResolvedValue({ _id: internaldoc_id });

    const resp = await requestWithSupertest
      .delete(`/api/docs/internal/${internaldoc_id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(InternaldocDAO.deleteById).toHaveBeenCalledWith(internaldoc_id);
  });
});
