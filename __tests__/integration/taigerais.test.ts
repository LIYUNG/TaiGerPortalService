// Integration test for the TaiGer AI routes — HTTP boundary down to the service,
// with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/taigerais ->
//   real ProgramService / ProgramAIService / CommunicationService /
//   ApplicationService / StudentService / PermissionService -> MOCKED DAOs.
//
// The AI controller streams from OpenAI and (for the program route) spawns a
// Python crawler — neither is a seam we own, so the OpenAI client and
// child_process.spawn are stubbed. The data boundary (program/communication/
// application/student/permission reads) is mocked at the DAO layer. The assertion
// for the streaming routes is "did NOT 500" plus the streamed body, because the
// body is a stream, not JSON. Fully deterministic — no engine flake, no DB.

import type { Request, Response, NextFunction } from 'express';

// The standard passthrough middleware mocks come from one shared helper (see
// __tests__/helpers/middlewareMocks). require() keeps them compatible with
// ts-jest's jest.mock hoisting. permission-filter below stays inline — this
// route stubs a different set of exports than the shared helper covers.
jest.mock('../../middlewares/tenantMiddleware', () =>
  require('../helpers/middlewareMocks').tenantMiddlewareMock()
);
jest.mock('../../middlewares/decryptCookieMiddleware', () =>
  require('../helpers/middlewareMocks').decryptCookieMiddlewareMock()
);
jest.mock('../../middlewares/auth', () =>
  require('../helpers/middlewareMocks').authMock()
);

jest.mock('../../middlewares/permission-filter', () => {
  const passthrough = async (req: Request, res: Response, next: NextFunction) =>
    next();
  return {
    ...jest.requireActual('../../middlewares/permission-filter'),
    permission_canModifyProgramList_filter: jest
      .fn()
      .mockImplementation(passthrough),
    permission_canUseTaiGerAI_filter: jest.fn().mockImplementation(passthrough),
    permission_TaiGerAIRatelimiter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/multitenant-filter', () =>
  require('../helpers/middlewareMocks').multitenantFilterMock()
);

jest.mock('../../middlewares/limit_archiv_user', () =>
  require('../helpers/middlewareMocks').limitArchivUserMock()
);

jest.mock('../../middlewares/chatMultitenantFilter', () => {
  const passthrough = async (req: Request, res: Response, next: NextFunction) =>
    next();
  return {
    ...jest.requireActual('../../middlewares/chatMultitenantFilter'),
    chatMultitenantFilter: jest.fn().mockImplementation(passthrough)
  };
});

// OpenAI streaming is mocked so no real API call is made (a real call would
// hang/timeout). The handlers iterate the stream and res.write() each chunk.
// Use mockImplementation (not a single mockResolvedValue) so EVERY call gets a
// FRESH async generator — an async generator is single-use, and reusing one
// exhausted instance across requests/tests yields an empty body.
jest.mock('../../services/openai', () => ({
  openAIClient: {
    chat: {
      completions: {
        create: jest.fn().mockImplementation(async () =>
          (async function* () {
            yield {
              choices: [
                {
                  delta: { content: 'mocked AI response' },
                  finish_reason: null
                }
              ]
            };
          })()
        )
      }
    }
  },
  OpenAiModel: { GPT_3_5_TURBO: 'gpt-3.5-turbo', GPT_4_o: 'gpt-4o' }
}));

// processProgramListAi spawns a Python crawler; mock spawn so the crawler does
// not actually run — it "closes" with code 0.
jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return {
    ...actual,
    spawn: jest.fn().mockImplementation(() => ({
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn((event, cb) => {
        if (event === 'close') cb(0);
      })
    }))
  };
});

jest.mock('../../services/email', () => ({
  sendSomeReminderEmail: jest.fn()
}));

// The data boundary: mock the DAOs the AI services delegate to.
jest.mock('../../dao/program.dao');
jest.mock('../../dao/programAI.dao');
jest.mock('../../dao/communication.dao');
jest.mock('../../dao/application.dao');
jest.mock('../../dao/student.dao');
jest.mock('../../dao/permission.dao');

import request from 'supertest';
import ProgramDAOModule from '../../dao/program.dao';
import ProgramAIDAOModule from '../../dao/programAI.dao';
import CommunicationDAOModule from '../../dao/communication.dao';
import ApplicationDAOModule from '../../dao/application.dao';
import StudentDAOModule from '../../dao/student.dao';
import PermissionDAOModule from '../../dao/permission.dao';
import { protect } from '../../middlewares/auth';
import { app } from '../../app';
import { TENANT_ID } from '../fixtures/constants';
import { admin, student } from '../mock/user';
const { ObjectId } = require('mongoose').Types;
import { generateProgram } from '../fixtures/faker';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

// The DAOs are auto-mocked above; re-type each as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const ProgramDAO = ProgramDAOModule as unknown as MockedDAO;
const ProgramAIDAO = ProgramAIDAOModule as unknown as MockedDAO;
const CommunicationDAO = CommunicationDAOModule as unknown as MockedDAO;
const ApplicationDAO = ApplicationDAOModule as unknown as MockedDAO;
const StudentDAO = StudentDAOModule as unknown as MockedDAO;
const PermissionDAO = PermissionDAOModule as unknown as MockedDAO;

const requestWithSupertest = request(app);

const program1 = generateProgram();

beforeEach(() => {
  jest.clearAllMocks();

  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = admin;
      next();
    }
  );

  // Sensible defaults; individual tests override as needed.
  ProgramDAO.getProgramByIdLean.mockResolvedValue(null);
  ProgramAIDAO.getByProgramId.mockResolvedValue(null);
  CommunicationDAO.getRecentByStudentId.mockResolvedValue([]);
  ApplicationDAO.getApplicationsByStudentId.mockResolvedValue([]);
  StudentDAO.getStudentByIdLean.mockResolvedValue(null);
  // decrementTaigerAiQuota reads the permission doc then .save()s it.
  PermissionDAO.getPermissionDocByUserId.mockResolvedValue({
    taigerAiQuota: 10,
    save: jest.fn().mockResolvedValue(undefined)
  });
});

// NOTE: the legacy POST /api/taigerai/chat/:studentId route was retired; the
// chat composer now uses /api/ai-assist/students/:id/reply-draft. Its test was
// removed with the route.

describe('cvmlrlAi Controller (full stack)', () => {
  it('POST /api/taigerai/cvmlrl streams a generated document without a server error', async () => {
    StudentDAO.getStudentByIdLean.mockResolvedValue({
      firstname: student.firstname,
      lastname: student.lastname,
      email: student.email,
      academic_background: {}
    });

    const resp = await requestWithSupertest
      .post('/api/taigerai/cvmlrl')
      .set('tenantId', TENANT_ID)
      .send({
        student_input: 'I am passionate about computer science',
        document_requirements: 'One page motivation letter',
        editor_requirements: JSON.stringify({ gptModel: 'gpt-3.5-turbo' }),
        program_full_name: 'MSc Computer Science at TU Munich',
        file_type: 'ML',
        student_id: student._id
      });

    expect(resp.status).not.toBe(500);
    expect(resp.text).toContain('mocked AI response');
    expect(StudentDAO.getStudentByIdLean).toHaveBeenCalledWith(
      student._id.toString()
    );
  });
});

describe('processProgramListAi Controller (full stack)', () => {
  it('GET /api/taigerai/program/:programId returns 200 when the program exists', async () => {
    ProgramDAO.getProgramByIdLean.mockResolvedValue({
      _id: program1._id,
      school: program1.school,
      program_name: program1.program_name,
      degree: program1.degree
    });
    ProgramAIDAO.getByProgramId.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .get(`/api/taigerai/program/${program1._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(ProgramDAO.getProgramByIdLean).toHaveBeenCalledWith(
      program1._id.toString()
    );
  });

  it('GET /api/taigerai/program/:programId returns an empty data object for a missing program', async () => {
    ProgramDAO.getProgramByIdLean.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .get(`/api/taigerai/program/${new ObjectId().toHexString()}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toEqual({});
  });
});
