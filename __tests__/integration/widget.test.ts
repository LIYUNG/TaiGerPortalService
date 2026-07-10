// Integration test for the widget routes — HTTP boundary down to the service,
// with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/widget ->
//   real CommunicationService -> MOCKED CommunicationDAO.
//
// The external boundaries (AWS S3 / API Gateway / STS) are stubbed because they
// are network calls, not seams we own. The controller logic and, for the PDF
// export, the Communication read path run for real against the mocked DAO. Fully
// deterministic — no engine flake.

// The standard passthrough middleware mocks come from one shared helper (see
// __tests__/helpers/middlewareMocks). require() keeps them compatible with
// ts-jest's jest.mock hoisting.
jest.mock('../../middlewares/tenantMiddleware', () =>
  require('../helpers/middlewareMocks').tenantMiddlewareMock()
);
jest.mock('../../middlewares/decryptCookieMiddleware', () =>
  require('../helpers/middlewareMocks').decryptCookieMiddlewareMock()
);
jest.mock('../../middlewares/auth', () =>
  require('../helpers/middlewareMocks').authMock()
);

// ../../aws is not a middleware — its callApiGateway/getTemporaryCredentials
// stubs stay inline.
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

// The data boundary: mock the DAO the communication service delegates to.
jest.mock('../../dao/communication.dao');

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import CommunicationDAOModule from '../../dao/communication.dao';
import { app } from '../../app';
import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';
import { admin, agent, student } from '../mock/user';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

// The DAO is auto-mocked above; re-type it as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const CommunicationDAO = CommunicationDAOModule as unknown as MockedDAO;

const requestWithSupertest = request(app);

// A communication thread as returned by the DAO (user_id populated).
const buildThread = (message: string) => ({
  _id: student._id,
  student_id: student._id,
  user_id: {
    _id: agent._id,
    firstname: agent.firstname,
    lastname: agent.lastname,
    role: agent.role
  },
  message,
  createdAt: new Date()
});

beforeEach(() => {
  jest.clearAllMocks();
  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = admin;
      next();
    }
  );
});

describe('WidgetExportMessagePDF Controller', () => {
  it('GET /api/widgets/messages/export/:studentId returns a non-empty PDF buffer built from the DAO thread', async () => {
    CommunicationDAO.getByStudentIdForExport.mockResolvedValue([
      buildThread('<p>hello</p>'),
      buildThread('<p>world</p>')
    ]);

    const resp = await requestWithSupertest
      .get(`/api/widgets/messages/export/${student._id}`)
      .set('tenantId', TENANT_ID)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(resp.status).toBe(200);
    expect(resp.headers['content-type']).toContain('application/pdf');
    expect(Buffer.isBuffer(resp.body)).toBe(true);
    expect(resp.body.length).toBeGreaterThan(0);
    // A jsPDF document always starts with the "%PDF" magic bytes.
    expect(resp.body.slice(0, 4).toString()).toBe('%PDF');
    expect(CommunicationDAO.getByStudentIdForExport).toHaveBeenCalledWith(
      student._id.toString()
    );
  });
});

describe('WidgetProcessTranscriptV2 Controller', () => {
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

describe('WidgetdownloadJson Controller', () => {
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
