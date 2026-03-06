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
    permit: jest.fn().mockImplementation((...roles) => passthrough)
  };
});

jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/InnerTaigerMultitenantFilter'),
    InnerTaigerMultitenantFilter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/permission-filter', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/permission-filter'),
    permission_canAccessStudentDatabase_filter: jest
      .fn()
      .mockImplementation(passthrough)
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

// Do NOT use jest.requireActual on file-upload — multerS3({ s3: s3Client }) is
// called at module eval time and crashes when s3Client is mocked.
jest.mock('../../middlewares/file-upload', () => {
  const passthrough = async (req, res, next) => {
    req.files = [];
    next();
  };
  return {
    imageUpload: passthrough,
    admissionUpload: passthrough,
    documentationDocsUpload: passthrough,
    VPDfileUpload: passthrough,
    ProfilefileUpload: passthrough,
    TemplatefileUpload: passthrough,
    MessagesThreadUpload: passthrough,
    MessagesTicketUpload: passthrough,
    MessagesChatUpload: passthrough,
    MessagesImageThreadUpload: passthrough,
    upload: passthrough
  };
});

jest.mock('../../aws', () => ({
  ...jest.requireActual('../../aws'),
  getTemporaryCredentials: jest.fn().mockResolvedValue({
    Credentials: {
      AccessKeyId: 'mock-key',
      SecretAccessKey: 'mock-secret',
      SessionToken: 'mock-token'
    }
  }),
  callApiGateway: jest.fn().mockResolvedValue({
    result: { courses: [], summary: 'mock' },
    statusCode: 200
  })
}));

// Mock aws/s3 directly so uploadJsonToS3 and getS3Object don't create real S3
// clients — putS3Object uses `new S3Client({})` internally which bypasses
// aws-sdk-client-mock and causes real network calls.
jest.mock('../../aws/s3', () => ({
  uploadJsonToS3: jest.fn().mockResolvedValue(undefined),
  getS3Object: jest
    .fn()
    .mockResolvedValue(
      Buffer.from(
        JSON.stringify({
          courses: [{ name: 'Calculus', grade: 90 }],
          summary: 'analysis result'
        })
      )
    ),
  putS3Object: jest.fn().mockResolvedValue({})
}));

const request = require('supertest');
const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { UserSchema } = require('../../models/User');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { users, admin, agent, student } = require('../mock/user');
const { disconnectFromDatabase } = require('../../database');
const { communicationsSchema } = require('../../models/Communication');
const { generateCommunicationMessage } = require('../fixtures/faker');

const requestWithSupertest = request(app);
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
  const CommunicationModel = db.model('Communication', communicationsSchema);

  await UserModel.deleteMany();
  await CommunicationModel.deleteMany();

  await UserModel.insertMany(users);

  const messages = [
    generateCommunicationMessage({
      studnet_id: student._id,
      user_id: agent._id
    }),
    generateCommunicationMessage({
      studnet_id: student._id,
      user_id: agent._id
    })
  ];
  await CommunicationModel.insertMany(messages);

  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('WidgetExportMessagePDF Controller', () => {
  it('GET /api/widgets/messages/export/:studentId should return 200 with a PDF buffer', async () => {
    const resp = await requestWithSupertest
      .get(`/api/widgets/messages/export/${student._id}`)
      .set('tenantId', TENANT_ID)
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(resp.status).toBe(200);
  });
});

describe('WidgetProcessTranscriptV2 Controller', () => {
  it('POST /api/widgets/transcript/engine/v2/:language should return 200 on success', async () => {
    const resp = await requestWithSupertest
      .post('/api/widgets/transcript/engine/v2/en')
      .set('tenantId', TENANT_ID)
      .send({
        courses: [{ name: 'Calculus', grade: '90', credits: '3' }],
        requirementIds: ['req1', 'req2'],
        factor: 1.5
      });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });
});

describe('WidgetdownloadJson Controller', () => {
  it('GET /api/widgets/transcript/v2/:adminId should return 200 with JSON data', async () => {
    const resp = await requestWithSupertest
      .get(`/api/widgets/transcript/v2/${admin._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.json).toBeDefined();
  });
});
