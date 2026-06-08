// Full-stack integration test for the widget routes:
//   supertest -> real router -> real controllers/widget -> real
//   CommunicationService -> real DAO -> in-memory MongoDB.
//
// The external boundaries (AWS S3 / API Gateway / STS) are stubbed because they
// are network calls, not seams we own — but the controller logic and, for the
// PDF export, the Communication read path run for real. Kept thin; the behaviour
// matrix lives in ../controllers/widget.test.js (mocked). Ported from the
// original controller test with assertions strengthened.

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
// clients (which bypass the sdk mock and make real network calls). aws/index.js
// and middlewares/file-upload.js both re-export s3Client from here, so the mock
// must keep a stub for it or requiring app.js (-> routes/account.js ->
// file-upload.js -> multerS3) throws "Expected opts.s3 to be object".
jest.mock('../../aws/s3', () => ({
  s3Client: { send: jest.fn(), config: { region: 'us-east-1' } },
  uploadJsonToS3: jest.fn().mockResolvedValue(undefined),
  getS3Object: jest.fn().mockResolvedValue(
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

describe('WidgetExportMessagePDF Controller (full stack)', () => {
  it('GET /api/widgets/messages/export/:studentId returns a non-empty PDF buffer', async () => {
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
    expect(resp.headers['content-type']).toContain('application/pdf');
    expect(Buffer.isBuffer(resp.body)).toBe(true);
    expect(resp.body.length).toBeGreaterThan(0);
    // A jsPDF document always starts with the "%PDF" magic bytes.
    expect(resp.body.slice(0, 4).toString()).toBe('%PDF');
  });
});

describe('WidgetProcessTranscriptV2 Controller (full stack)', () => {
  it('POST /api/widgets/transcript/engine/v2/:language returns analysis metadata', async () => {
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
    expect(resp.body.data.isAnalysedV2).toBe(true);
    expect(resp.body.data.pathV2).toContain(admin._id.toString());
  });
});

describe('WidgetdownloadJson Controller (full stack)', () => {
  it('GET /api/widgets/transcript/v2/:adminId returns the parsed JSON data', async () => {
    const resp = await requestWithSupertest
      .get(`/api/widgets/transcript/v2/${admin._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.json).toEqual({
      courses: [{ name: 'Calculus', grade: 90 }],
      summary: 'analysis result'
    });
  });
});
