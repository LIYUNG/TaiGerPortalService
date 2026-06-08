// Controller UNIT test for controllers/documentations.
//
// The handlers are plain (req, res, next) functions (wrapped by asyncHandler),
// so we call them DIRECTLY with fake req/res/next and a MOCKED service layer.
// No route, no supertest, no middleware, no database. We assert ONLY the
// controller's own work: the (id-stripped, author-stamped) args it forwards to
// DocumentationService, the status + body it writes to res, the category
// validation it owns, and that a service error is forwarded to next().
//
// The full route -> controller -> service -> dao -> in-memory Mongo wiring is
// covered by __tests__/integration/documentations.test.js.

jest.mock('../../services/documentations');
jest.mock('../../cache/node-cache', () => ({
  ten_minutes_cache: {
    get: jest.fn().mockReturnValue(undefined),
    set: jest.fn().mockReturnValue(true),
    del: jest.fn().mockReturnValue(1),
    flushAll: jest.fn()
  }
}));
jest.mock('../../aws/s3', () => ({
  getS3Object: jest.fn().mockResolvedValue(Buffer.from('file-bytes'))
}));

const { ObjectId } = require('mongoose').Types;
const DocumentationService = require('../../services/documentations');
const { ten_minutes_cache } = require('../../cache/node-cache');
const { getS3Object } = require('../../aws/s3');
const {
  getCategoryDocumentations,
  getAllDocumentations,
  getAllInternalDocumentations,
  getDocumentation,
  createDocumentation,
  createInternalDocumentation,
  updateDocumentation,
  updateInternalDocumentation,
  deleteDocumentation,
  getCategoryDocumentationsPage,
  getDocFile
} = require('../../controllers/documentations');
const { mockReq, mockRes } = require('../helpers/httpMocks');
const { admin } = require('../mock/user');

const authorStamp = `${admin.firstname} ${admin.lastname}`;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createDocumentation', () => {
  it('strips _id from the body and forwards the rest to the service', async () => {
    const created = { _id: 'd1', title: 'T', text: 'X' };
    DocumentationService.createDocumentation.mockResolvedValue(created);
    const res = mockRes();

    await createDocumentation(
      mockReq({ body: { _id: 'should-be-stripped', title: 'T', text: 'X' } }),
      res,
      jest.fn()
    );

    const fields = DocumentationService.createDocumentation.mock.calls[0][0];
    expect(fields).not.toHaveProperty('_id');
    expect(fields).toMatchObject({ title: 'T', text: 'X' });
    expect(res.send).toHaveBeenCalledWith({ success: true, data: created });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    DocumentationService.createDocumentation.mockRejectedValue(err);
    const next = jest.fn();

    await createDocumentation(
      mockReq({ body: { title: 'T' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('createInternalDocumentation', () => {
  it('strips _id and forwards to the internal-create service', async () => {
    const created = { _id: 'i1', title: 'IT' };
    DocumentationService.createInternalDocumentation.mockResolvedValue(created);
    const res = mockRes();

    await createInternalDocumentation(
      mockReq({ body: { _id: 'strip', title: 'IT', internal: true } }),
      res,
      jest.fn()
    );

    const fields =
      DocumentationService.createInternalDocumentation.mock.calls[0][0];
    expect(fields).not.toHaveProperty('_id');
    expect(fields).toMatchObject({ title: 'IT' });
    expect(res.send).toHaveBeenCalledWith({ success: true, data: created });
  });
});

describe('getCategoryDocumentations', () => {
  it('200: returns documentations for a valid category, forwarding it', async () => {
    const docs = [{ _id: 'd1' }, { _id: 'd2' }];
    DocumentationService.getDocumentationsByCategory.mockResolvedValue(docs);
    const res = mockRes();

    await getCategoryDocumentations(
      mockReq({ params: { category: 'uniassist' } }),
      res,
      jest.fn()
    );

    expect(
      DocumentationService.getDocumentationsByCategory
    ).toHaveBeenCalledWith('uniassist');
    expect(res.send).toHaveBeenCalledWith({ success: true, data: docs });
  });

  it('forwards a 400 ErrorResponse to next() for an invalid category (no service call)', async () => {
    const next = jest.fn();

    await getCategoryDocumentations(
      mockReq({ params: { category: 'not-a-real-category' } }),
      mockRes(),
      next
    );

    expect(
      DocumentationService.getDocumentationsByCategory
    ).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 })
    );
  });
});

describe('getAllDocumentations / getAllInternalDocumentations', () => {
  it('getAllDocumentations: forwards what the service resolves', async () => {
    const docs = [{ _id: 'd1', title: 'T' }];
    DocumentationService.getAllDocumentations.mockResolvedValue(docs);
    const res = mockRes();

    await getAllDocumentations(mockReq(), res, jest.fn());

    expect(DocumentationService.getAllDocumentations).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: docs });
  });

  it('getAllInternalDocumentations: forwards what the service resolves', async () => {
    const docs = [{ _id: 'i1' }];
    DocumentationService.getAllInternalDocumentations.mockResolvedValue(docs);
    const res = mockRes();

    await getAllInternalDocumentations(mockReq(), res, jest.fn());

    expect(res.send).toHaveBeenCalledWith({ success: true, data: docs });
  });
});

describe('getDocumentation', () => {
  it('forwards req.params.doc_id and returns the documentation', async () => {
    const docId = new ObjectId().toHexString();
    const doc = { _id: docId, title: 'T' };
    DocumentationService.getDocumentationById.mockResolvedValue(doc);
    const res = mockRes();

    await getDocumentation(
      mockReq({ params: { doc_id: docId } }),
      res,
      jest.fn()
    );

    expect(DocumentationService.getDocumentationById).toHaveBeenCalledWith(
      docId
    );
    expect(res.send).toHaveBeenCalledWith({ success: true, data: doc });
  });
});

describe('updateDocumentation', () => {
  it('201: stamps author from req.user and forwards id + fields', async () => {
    const docId = new ObjectId().toHexString();
    const updated = { _id: docId, title: 'New' };
    DocumentationService.updateDocumentationById.mockResolvedValue(updated);
    const res = mockRes();

    await updateDocumentation(
      mockReq({
        params: { id: docId },
        body: { title: 'New', text: 'Body' },
        user: admin
      }),
      res,
      jest.fn()
    );

    expect(DocumentationService.updateDocumentationById).toHaveBeenCalledWith(
      docId,
      expect.objectContaining({ title: 'New', author: authorStamp })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: updated });
  });
});

describe('updateInternalDocumentation', () => {
  it('201: stamps author and forwards to the internal-update service', async () => {
    const docId = new ObjectId().toHexString();
    const updated = { _id: docId, title: 'IU' };
    DocumentationService.updateInternalDocumentationById.mockResolvedValue(
      updated
    );
    const res = mockRes();

    await updateInternalDocumentation(
      mockReq({ params: { id: docId }, body: { title: 'IU' }, user: admin }),
      res,
      jest.fn()
    );

    expect(
      DocumentationService.updateInternalDocumentationById
    ).toHaveBeenCalledWith(
      docId,
      expect.objectContaining({ title: 'IU', author: authorStamp })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('deleteDocumentation', () => {
  it('200: forwards the id to the service and responds { success: true }', async () => {
    const docId = new ObjectId().toHexString();
    DocumentationService.deleteDocumentationById.mockResolvedValue({});
    const res = mockRes();

    await deleteDocumentation(
      mockReq({ params: { id: docId } }),
      res,
      jest.fn()
    );

    expect(DocumentationService.deleteDocumentationById).toHaveBeenCalledWith(
      docId
    );
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });
});

describe('getCategoryDocumentationsPage', () => {
  it('cache-miss: fetches the docspage and forwards req.params.category', async () => {
    ten_minutes_cache.get.mockReturnValue(undefined); // cache miss
    const page = { _id: 'p1', category: 'uniassist' };
    DocumentationService.getDocspageByCategory.mockResolvedValue(page);
    const res = mockRes();

    await getCategoryDocumentationsPage(
      mockReq({ params: { category: 'uniassist' }, user: admin, url: '/u' }),
      res,
      jest.fn()
    );

    expect(DocumentationService.getDocspageByCategory).toHaveBeenCalledWith(
      'uniassist'
    );
    expect(res.send).toHaveBeenCalledWith({ success: true, data: page });
  });

  it('forwards a 400 ErrorResponse to next() for an invalid category', async () => {
    const next = jest.fn();

    await getCategoryDocumentationsPage(
      mockReq({ params: { category: 'bogus' }, user: admin, url: '/u' }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 })
    );
  });
});

describe('getDocFile', () => {
  it('cache-miss: streams the S3 object as an attachment', async () => {
    ten_minutes_cache.get.mockReturnValue(undefined); // cache miss
    const res = mockRes();
    res.attachment = jest.fn(() => res);

    await getDocFile(
      mockReq({ params: { object_key: 'my-file.pdf' }, originalUrl: '/f' }),
      res,
      jest.fn()
    );

    expect(getS3Object).toHaveBeenCalledTimes(1);
    expect(res.attachment).toHaveBeenCalledWith('my-file.pdf');
    expect(res.end).toHaveBeenCalled();
  });
});
