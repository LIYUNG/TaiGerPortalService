// Controller UNIT test for controllers/widget.
//
// The handlers are plain (req, res, next) functions (wrapped by asyncHandler), so
// we call them DIRECTLY with fake req/res/next. The service layer
// (CommunicationService) and every external boundary (AWS S3 / API Gateway / STS)
// are MOCKED so NO database and NO network is touched. We assert ONLY the
// controller's own work: the args it forwards downstream, the metadata it builds
// from req.user, the status + body / content-type it writes, and error handling
// (this controller catches the gateway failure itself -> 403). Full-stack
// coverage lives in __tests__/integration/widget.test.js.

jest.mock('../../services/communications');

// Mock aws/s3 directly so uploadJsonToS3 / getS3Object don't create real S3
// clients. aws/index.js re-exports s3Client from here, so keep a stub for it.
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

const CommunicationService = require('../../services/communications');
const { getS3Object, uploadJsonToS3 } = require('../../aws/s3');
const { callApiGateway, getTemporaryCredentials } = require('../../aws');
const {
  WidgetProcessTranscriptV2,
  WidgetdownloadJson,
  WidgetExportMessagePDF
} = require('../../controllers/widget');
const { mockReq, mockRes } = require('../helpers/httpMocks');
const { admin, student } = require('../mock/user');

const studentId = student._id.toString();
const adminId = admin._id.toString();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('WidgetExportMessagePDF', () => {
  it('reads the thread for req.params.studentId and writes a PDF buffer', async () => {
    CommunicationService.getByStudentIdForExport.mockResolvedValue([]);
    const req = mockReq({ user: admin, params: { studentId } });
    const res = mockRes();
    // The shared mockRes() helper doesn't stub res.contentType (Express adds it);
    // add it here so the handler can set the PDF content type.
    res.contentType = jest.fn(() => res);

    await WidgetExportMessagePDF(req, res, jest.fn());

    expect(CommunicationService.getByStudentIdForExport).toHaveBeenCalledWith(
      studentId
    );
    expect(res.contentType).toHaveBeenCalledWith('application/pdf');
    const sent = res.send.mock.calls[0][0];
    expect(Buffer.isBuffer(sent)).toBe(true);
    // A jsPDF document always starts with the "%PDF" magic bytes.
    expect(sent.slice(0, 4).toString()).toBe('%PDF');
  });

  it('renders thread messages, exercising the student + non-student name branches and a parse error', async () => {
    const { Role } = require('@taiger-common/core');
    const editorJson = JSON.stringify({
      blocks: [
        { type: 'paragraph', data: { text: 'Hello there' } },
        { type: 'header', data: { text: 'ignored' } }
      ]
    });
    CommunicationService.getByStudentIdForExport.mockResolvedValue([
      {
        // Student author -> the chinese-name suffix branch is taken.
        user_id: {
          firstname: 'San',
          lastname: 'Wang',
          firstname_chinese: '三',
          lastname_chinese: '王',
          role: Role.Student
        },
        message: `<p>${editorJson}</p>`,
        createdAt: '2024-01-01T00:00:00.000Z'
      },
      {
        // Non-student author -> no chinese suffix; null message -> '' textContent.
        user_id: {
          firstname: 'Ed',
          lastname: 'Itor',
          role: Role.Editor
        },
        message: null,
        createdAt: '2024-01-02T00:00:00.000Z'
      },
      {
        // Invalid JSON in the message -> JSON.parse throws -> catch branch.
        user_id: {
          firstname: 'Bad',
          lastname: 'Json',
          role: Role.Agent
        },
        message: '<p>{not valid json}</p>',
        createdAt: '2024-01-03T00:00:00.000Z'
      }
    ]);
    const req = mockReq({ user: admin, params: { studentId } });
    const res = mockRes();
    res.contentType = jest.fn(() => res);

    await WidgetExportMessagePDF(req, res, jest.fn());

    expect(res.contentType).toHaveBeenCalledWith('application/pdf');
    const sent = res.send.mock.calls[0][0];
    expect(Buffer.isBuffer(sent)).toBe(true);
    expect(sent.slice(0, 4).toString()).toBe('%PDF');
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    CommunicationService.getByStudentIdForExport.mockRejectedValue(err);
    const next = jest.fn();

    await WidgetExportMessagePDF(
      mockReq({ user: admin, params: { studentId } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('WidgetProcessTranscriptV2', () => {
  it('calls the gateway, uploads the result, and returns analysis metadata keyed by req.user._id', async () => {
    const req = mockReq({
      user: admin,
      params: { language: 'en' },
      body: {
        courses: [{ name: 'Calculus', grade: '90', credits: '3' }],
        requirementIds: ['req1', 'req2'],
        factor: 1.5
      }
    });
    const res = mockRes();

    await WidgetProcessTranscriptV2(req, res, jest.fn());

    expect(getTemporaryCredentials).toHaveBeenCalledTimes(1);
    expect(callApiGateway).toHaveBeenCalledTimes(1);
    expect(uploadJsonToS3).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.isAnalysedV2).toBe(true);
    // pathV2 is derived from req.user._id.
    expect(body.data.pathV2).toContain(adminId);
  });

  it('catches a gateway failure itself and responds 403', async () => {
    callApiGateway.mockRejectedValueOnce(new Error('gateway down'));
    const req = mockReq({
      user: admin,
      params: { language: 'en' },
      body: { courses: [], requirementIds: [], factor: 1.5 }
    });
    const res = mockRes();
    const next = jest.fn();

    await WidgetProcessTranscriptV2(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    // Handler catches internally -> error is NOT forwarded to next().
    expect(next).not.toHaveBeenCalled();
  });
});

describe('WidgetdownloadJson', () => {
  it('reads the analysed JSON from S3 and responds 200 with the parsed data', async () => {
    const req = mockReq({ user: admin, params: { adminId } });
    const res = mockRes();

    await WidgetdownloadJson(req, res, jest.fn());

    expect(getS3Object).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.json).toEqual({
      courses: [{ name: 'Calculus', grade: 90 }],
      summary: 'analysis result'
    });
  });

  it('forwards an S3 error to next()', async () => {
    const err = new Error('s3 down');
    getS3Object.mockRejectedValueOnce(err);
    const next = jest.fn();

    await WidgetdownloadJson(
      mockReq({ user: admin, params: { adminId } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});
