// Full-stack integration test for the documents_modification routes:
//   supertest -> real router (routes/documents_modification) ->
//   real controllers/documents_modification -> real services -> real DAOs ->
//   in-memory MongoDB.
//
// Only the auth/tenant/permission/upload middleware and the S3 + email side
// channels are stubbed; everything from the route down to the DB runs for real.
// This complements ../integration/documentthread.test.js (same router) by
// covering a DIFFERENT, thin slice — the overview *counts* endpoints and the
// survey-input reset/delete lifecycle — so a seam bug in those queries surfaces
// here. Exhaustive per-handler behaviour lives in the mocked controller unit
// tests (../controllers/documents_modification.test.js + documentthread.test.js).

const request = require('supertest');
const { ObjectId } = require('mongoose').Types;

const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { UserSchema } = require('../../models/User');
const { documentThreadsSchema } = require('../../models/Documentthread');
const { surveyInputSchema } = require('../../models/SurveyInput');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { users, admin, agent, student } = require('../mock/user');
const { disconnectFromDatabase } = require('../../database');

const requestWithSupertest = request(app);

jest.mock('../../middlewares/tenantMiddleware', () => {
  const passthrough = async (req, res, next) => {
    req.tenantId = 'test';
    next();
  };
  return {
    ...jest.requireActual('../../middlewares/tenantMiddleware'),
    checkTenantDBMiddleware: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/decryptCookieMiddleware', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/decryptCookieMiddleware'),
    decryptCookieMiddleware: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation(() => passthrough)
  };
});

jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/InnerTaigerMultitenantFilter'),
    InnerTaigerMultitenantFilter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/multitenant-filter', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/multitenant-filter'),
    multitenant_filter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/limit_archiv_user', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/limit_archiv_user'),
    filter_archiv_user: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/file-upload', () => {
  const passthrough = async (req, res, next) => {
    req.files = [];
    next();
  };
  const passthroughSingle = async (req, res, next) => {
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

jest.mock('../../middlewares/documentThreadMultitenantFilter', () => {
  const passthrough = async (req, res, next) => next();
  return {
    docThreadMultitenant_filter: jest.fn().mockImplementation(passthrough),
    surveyMultitenantFilter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/AssignOutsourcerFilter', () => {
  const passthrough = async (req, res, next) => next();
  return { AssignOutsourcerFilter: jest.fn().mockImplementation(passthrough) };
});

jest.mock('../../middlewares/editorIdsBodyFilter', () => {
  const passthrough = async (req, res, next) => next();
  return { editorIdsBodyFilter: jest.fn().mockImplementation(passthrough) };
});

jest.mock('../../middlewares/docs_thread_operation_validation', () => {
  const passthrough = async (req, res, next) => next();
  return {
    doc_thread_ops_validator: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../services/email', () => ({
  sendNewGeneraldocMessageInThreadEmail: jest.fn(),
  sendNewApplicationMessageInThreadEmail: jest.fn(),
  assignEssayTaskToEditorEmail: jest.fn(),
  sendSetAsFinalGeneralFileForAgentEmail: jest.fn(),
  sendSetAsFinalGeneralFileForStudentEmail: jest.fn(),
  sendSetAsFinalProgramSpecificFileForStudentEmail: jest.fn(),
  sendSetAsFinalProgramSpecificFileForAgentEmail: jest.fn(),
  assignDocumentTaskToEditorEmail: jest.fn(),
  assignDocumentTaskToStudentEmail: jest.fn(),
  sendAssignEditorReminderEmail: jest.fn(),
  sendAssignEssayWriterReminderEmail: jest.fn(),
  sendAssignTrainerReminderEmail: jest.fn(),
  sendNewInterviewMessageInThreadEmail: jest.fn(),
  informOnSurveyUpdate: jest.fn(),
  informEssayWriterNewEssayEmail: jest.fn(),
  informStudentTheirEssayWriterEmail: jest.fn(),
  informAgentEssayAssignedEmail: jest.fn()
}));

jest.mock('../../aws/s3', () => ({
  getS3Object: jest.fn().mockResolvedValue({ Body: { pipe: jest.fn() } }),
  putS3Object: jest.fn().mockResolvedValue({}),
  deleteS3Object: jest.fn().mockResolvedValue({}),
  deleteS3Objects: jest.fn().mockResolvedValue({}),
  listS3ObjectsV2: jest.fn().mockResolvedValue({ Contents: [] })
}));

jest.mock('../../utils/informEditor', () => ({
  informOnSurveyUpdate: jest.fn().mockResolvedValue({})
}));

jest.mock('../../utils/log/auditLog', () => ({
  auditLog: (req, res, next) => next()
}));

const threadId = new ObjectId().toHexString();
const surveyInputId = new ObjectId().toHexString();

let dbUri;

beforeAll(async () => {
  dbUri = await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  const db = connectToDatabase(TENANT_ID, dbUri);

  const UserModel = db.model('User', UserSchema);
  const DocumentthreadModel = db.model('Documentthread', documentThreadsSchema);
  const SurveyInputModel = db.model('surveyInput', surveyInputSchema);

  await UserModel.deleteMany();
  await DocumentthreadModel.deleteMany();
  await SurveyInputModel.deleteMany();

  await UserModel.insertMany(users);

  await DocumentthreadModel.create({
    _id: threadId,
    student_id: student._id,
    file_type: 'ML',
    application_id: null,
    messages: [],
    updatedAt: new Date()
  });

  await SurveyInputModel.create({
    _id: surveyInputId,
    studentId: student._id,
    programId: null,
    fileType: 'ML',
    surveyContent: { foo: 'bar' },
    surveyStatus: 'provided'
  });

  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('GET /api/document-threads/overview/all/counts (full stack)', () => {
  it('returns a counts payload (object) for active threads', async () => {
    const resp = await requestWithSupertest
      .get('/api/document-threads/overview/all/counts')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(typeof resp.body.data).toBe('object');
  });
});

describe('GET /api/document-threads/overview/taiger-user/:userId/counts (full stack)', () => {
  it('returns a counts payload for the supervised students of a user', async () => {
    const resp = await requestWithSupertest
      .get(`/api/document-threads/overview/taiger-user/${agent._id}/counts`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(typeof resp.body.data).toBe('object');
  });
});

describe('DELETE /api/document-threads/survey-input/:surveyInputId (full stack)', () => {
  it('resets the seeded survey input via the real service/dao and returns it', async () => {
    // resetSurveyInputById does `$unset: { 'surveyContent.$[].answer': 1 }` —
    // it clears the answers inside surveyContent, it does NOT change
    // surveyStatus. So the deterministic contract here is: the route round-trips
    // through the real service -> dao -> Mongo and returns the same document.
    const resp = await requestWithSupertest
      .delete(`/api/document-threads/survey-input/${surveyInputId}`)
      .set('tenantId', TENANT_ID)
      .send({ informEditor: false });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id.toString()).toBe(surveyInputId);
  });
});

describe('GET /api/document-threads/student-threads/:studentId (full stack)', () => {
  it('returns the student thread payload as a real read', async () => {
    protect.mockImplementation(async (req, res, next) => {
      req.user = agent;
      next();
    });
    const resp = await requestWithSupertest
      .get(`/api/document-threads/student-threads/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toHaveProperty('threads');
  });
});
