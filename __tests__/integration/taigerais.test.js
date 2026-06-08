// Full-stack integration test for the TaiGer AI routes:
//   supertest -> real router -> real controllers/taigerais -> real services ->
//   real DAOs -> in-memory MongoDB.
//
// The AI controller streams from OpenAI and (for the program route) spawns a
// Python crawler — neither is a seam we own, so the OpenAI client and
// child_process.spawn are stubbed. Everything ELSE below the route (routing,
// auth/permission wiring, the program/communication DB reads) runs for real, so
// a seam bug surfaces here. Kept thin; the per-handler behaviour matrix lives in
// ../controllers/taigerais.test.js (fully mocked). The assertion for the
// streaming routes is "did NOT 500" because the body is a stream, not JSON.

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

jest.mock('../../middlewares/permission-filter', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/permission-filter'),
    permission_canModifyProgramList_filter: jest
      .fn()
      .mockImplementation(passthrough),
    permission_canUseTaiGerAI_filter: jest.fn().mockImplementation(passthrough),
    permission_TaiGerAIRatelimiter: jest.fn().mockImplementation(passthrough)
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

jest.mock('../../middlewares/chatMultitenantFilter', () => {
  const passthrough = async (req, res, next) => next();
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

// processProgramListAi spawns a Python crawler; mock spawn so MongoMemoryServer's
// own mongod still launches but the crawler does not — it "closes" with code 0.
jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return {
    ...actual,
    spawn: jest.fn().mockImplementation((command, args, options) => {
      if (typeof command === 'string' && command.includes('mongod')) {
        return actual.spawn(command, args, options);
      }
      return {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
          if (event === 'close') cb(0);
        })
      };
    })
  };
});

jest.mock('../../services/email', () => ({
  sendSomeReminderEmail: jest.fn()
}));

// models/ProgramAI.js has a typo (`model.exports` instead of `module.exports`),
// so the real module exports {} and ProgramAI is undefined, causing a TypeError.
// Mock it so processProgramListAi can run to completion.
jest.mock('../../models/ProgramAI', () => ({
  ProgramAI: {
    findOne: jest
      .fn()
      .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) })
  }
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
const { permissionSchema } = require('../../models/Permission');
const { communicationsSchema } = require('../../models/Communication');
const { applicationSchema } = require('../../models/Application');
const { programSchema } = require('../../models/Program');
const { ObjectId } = require('mongoose').Types;
const {
  generateProgram,
  generateCommunicationMessage
} = require('../fixtures/faker');

const requestWithSupertest = request(app);
let dbUri;

const program1 = generateProgram();

const adminPermission = {
  _id: new ObjectId().toHexString(),
  user_id: admin._id,
  taigerAiQuota: 10,
  canUseTaiGerAI: true,
  canModifyProgramList: true
};

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
  const PermissionModel = db.model('Permission', permissionSchema);
  const CommunicationModel = db.model('Communication', communicationsSchema);
  const ApplicationModel = db.model('Application', applicationSchema);
  const ProgramModel = db.model('Program', programSchema);

  await UserModel.deleteMany();
  await PermissionModel.deleteMany();
  await CommunicationModel.deleteMany();
  await ApplicationModel.deleteMany();
  await ProgramModel.deleteMany();

  await UserModel.insertMany(users);
  await PermissionModel.insertMany([adminPermission]);
  await ProgramModel.insertMany([program1]);

  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('TaiGerAiGeneral Controller (full stack)', () => {
  it('POST /api/taigerai/general streams the AI response without a server error', async () => {
    const resp = await requestWithSupertest
      .post('/api/taigerai/general')
      .set('tenantId', TENANT_ID)
      .send({
        prompt: 'What is the capital of Germany?',
        model: 'gpt-3.5-turbo'
      });

    expect(resp.status).not.toBe(500);
    // The handler streams the mocked chunk straight to the response body.
    expect(resp.text).toContain('mocked AI response');
  });
});

describe('TaiGerAiChat Controller (full stack)', () => {
  it('POST /api/taigerai/chat/:studentId streams a response built from the seeded thread', async () => {
    const db = connectToDatabase(TENANT_ID, dbUri);
    const CommunicationModel = db.model('Communication', communicationsSchema);
    const messages = [
      generateCommunicationMessage({
        studnet_id: student._id,
        user_id: agent._id
      }),
      generateCommunicationMessage({
        studnet_id: student._id,
        user_id: student._id
      })
    ];
    await CommunicationModel.insertMany(messages);

    const resp = await requestWithSupertest
      .post(`/api/taigerai/chat/${student._id}`)
      .set('tenantId', TENANT_ID)
      .send({ prompt: 'What documents do I need?' });

    expect(resp.status).not.toBe(500);
    expect(resp.text).toContain('mocked AI response');
  });
});

describe('cvmlrlAi Controller (full stack)', () => {
  it('POST /api/taigerai/cvmlrl streams a generated document without a server error', async () => {
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
  });
});

describe('processProgramListAi Controller (full stack)', () => {
  it('GET /api/taigerai/program/:programId returns 200 when the program exists', async () => {
    const resp = await requestWithSupertest
      .get(`/api/taigerai/program/${program1._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
  });

  it('GET /api/taigerai/program/:programId returns an empty data object for a missing program', async () => {
    const resp = await requestWithSupertest
      .get(`/api/taigerai/program/${new ObjectId().toHexString()}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toEqual({});
  });
});
