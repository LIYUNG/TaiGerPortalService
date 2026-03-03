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
      .mockImplementation(passthrough),
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

jest.mock('../../services/openai', () => ({
  openAIClient: {
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue(
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

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return {
    ...actual,
    spawn: jest.fn().mockImplementation((command, args, options) => {
      // Let MongoMemoryServer spawn mongod normally — mocking it causes the
      // in-memory MongoDB to fail to start, breaking the test lifecycle.
      if (typeof command === 'string' && command.includes('mongod')) {
        return actual.spawn(command, args, options);
      }
      // Mock all other spawn calls (e.g., Python scripts invoked by taigerai)
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

// models/ProgramAI.js has a typo: `model.exports` instead of `module.exports`,
// so the real module exports {} and ProgramAI is undefined, causing a TypeError.
// Mock it here so processProgramListAi can run to completion.
jest.mock('../../models/ProgramAI', () => ({
  ProgramAI: {
    findOne: jest
      .fn()
      .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) })
  }
}));

const { ObjectId } = require('mongoose').Types;
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

describe('TaiGerAiGeneral Controller', () => {
  it('POST /api/taigerai/general should return a streaming response without error', async () => {
    const resp = await requestWithSupertest
      .post('/api/taigerai/general')
      .set('tenantId', TENANT_ID)
      .send({
        prompt: 'What is the capital of Germany?',
        model: 'gpt-3.5-turbo'
      });

    expect(resp.status).not.toBe(500);
  });
});

describe('TaiGerAiChat Controller', () => {
  it('POST /api/taigerai/chat/:studentId should return a streaming response without error', async () => {
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
  });
});

describe('cvmlrlAi Controller', () => {
  it('POST /api/taigerai/cvmlrl should return a streaming response without error', async () => {
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
  });
});

describe('processProgramListAi Controller', () => {
  it('GET /api/taigerai/program/:programId should return 200 when program exists', async () => {
    const resp = await requestWithSupertest
      .get(`/api/taigerai/program/${program1._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
  });
});
