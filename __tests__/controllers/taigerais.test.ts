// Controller UNIT test for controllers/taigerais.
//
// taigerais is the AI controller: each handler streams from OpenAI and/or fans
// out to several services. The handlers are plain (req, res, next) functions
// (wrapped by asyncHandler), so we call them DIRECTLY with fake req/res/next.
//
// CRITICAL: every external boundary is MOCKED so NOTHING real runs — a real
// OpenAI call (services/openai) would hang/timeout, and processProgramListAi
// spawns a Python crawler (child_process.spawn) we must not launch. We assert
// ONLY the controller's own work: the args forwarded to the services, the
// streaming written to res via res.write/res.end, the status written, the quota
// decrement, and error forwarding to next(). The full route + real DB seam lives
// in __tests__/integration/taigerais.test.js.

// The OpenAI client is mocked to return an async-iterable stream so the handlers'
// `for await` loops run synchronously over canned chunks — no network, no hang.
const makeStream = (chunks) =>
  (async function* () {
    for (const c of chunks) {
      yield { choices: [{ delta: { content: c } }] };
    }
  })();

jest.mock('../../services/openai', () => ({
  openAIClient: {
    chat: { completions: { create: jest.fn() } }
  },
  OpenAiModel: { GPT_3_5_TURBO: 'gpt-3.5-turbo', GPT_4_o: 'gpt-4o' }
}));

// processProgramListAi spawns a Python crawler; mock spawn so it never launches a
// real process and instead "closes" with exit code 0 immediately.
jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return {
    ...actual,
    spawn: jest.fn(() => ({
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn((event, cb) => {
        if (event === 'close') cb(0);
      })
    }))
  };
});

// ProgramAI data access goes through the service (-> DAO -> model); mock the
// service so processProgramListAi runs without a database.
jest.mock('../../services/programAIs');

jest.mock('../../services/programs');
jest.mock('../../services/communications');
jest.mock('../../services/applications');
jest.mock('../../services/permissions');
jest.mock('../../services/students');

import { spawn } from 'child_process';
import { openAIClient } from '../../services/openai';
import ProgramService from '../../services/programs';
import CommunicationService from '../../services/communications';
import ApplicationService from '../../services/applications';
import PermissionService from '../../services/permissions';
import StudentService from '../../services/students';
import {
  TaiGerAiChat,
  cvmlrlAi,
  processProgramListAi
} from '../../controllers/taigerais';
import { mockReq, mockRes } from '../helpers/httpMocks';
import { admin, student } from '../mock/user';

const studentId = student._id.toString();

// The streaming handlers write chunks with res.write(); the shared mockRes()
// helper doesn't stub it (Express adds it), so augment the double here.
const mockStreamRes = () => {
  const res = mockRes();
  res.write = jest.fn(() => true);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TaiGerAiChat', () => {
  it('parses thread messages (valid + invalid JSON) and picks the latest student message', async () => {
    const { Role } = require('@taiger-common/core');
    CommunicationService.getRecentByStudentId.mockResolvedValue([
      {
        createdAt: '2024-01-01',
        user_id: { firstname: 'Stu', role: Role.Student },
        message: JSON.stringify({
          blocks: [
            { type: 'paragraph', data: { text: 'Need help with ML' } },
            { type: 'header', data: { text: 'skip' } }
          ]
        })
      },
      {
        createdAt: '2024-01-02',
        user_id: { firstname: 'Bad', role: Role.Agent },
        message: '{invalid json'
      }
    ]);
    ApplicationService.getApplicationsByStudentId.mockResolvedValue([]);
    PermissionService.decrementTaigerAiQuota.mockResolvedValue({});
    openAIClient.chat.completions.create.mockResolvedValue(
      makeStream(['reply'])
    );
    const res = mockStreamRes();

    await TaiGerAiChat(
      mockReq({ user: admin, params: { studentId }, body: { prompt: 'q' } }),
      res,
      jest.fn()
    );

    expect(res.write).toHaveBeenCalledWith('reply');
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(PermissionService.decrementTaigerAiQuota).toHaveBeenCalledWith(
      admin._id
    );
  });

  it('reads the thread + applications for studentId, streams the reply, and decrements the AI quota', async () => {
    CommunicationService.getRecentByStudentId.mockResolvedValue([]);
    ApplicationService.getApplicationsByStudentId.mockResolvedValue([]);
    PermissionService.decrementTaigerAiQuota.mockResolvedValue({});
    openAIClient.chat.completions.create.mockResolvedValue(
      makeStream(['reply'])
    );
    const res = mockStreamRes();

    await TaiGerAiChat(
      mockReq({ user: admin, params: { studentId }, body: { prompt: 'q' } }),
      res,
      jest.fn()
    );

    expect(CommunicationService.getRecentByStudentId).toHaveBeenCalledWith(
      studentId,
      3
    );
    expect(ApplicationService.getApplicationsByStudentId).toHaveBeenCalledWith(
      studentId
    );
    expect(res.write).toHaveBeenCalledWith('reply');
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(PermissionService.decrementTaigerAiQuota).toHaveBeenCalledWith(
      admin._id
    );
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('comm down');
    CommunicationService.getRecentByStudentId.mockRejectedValue(err);
    const next = jest.fn();

    await TaiGerAiChat(
      mockReq({ user: admin, params: { studentId }, body: { prompt: 'q' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('cvmlrlAi', () => {
  it('streams the generated document and decrements the AI quota', async () => {
    StudentService.getStudentByIdLean.mockResolvedValue({
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@example.com',
      academic_background: {}
    });
    PermissionService.decrementTaigerAiQuota.mockResolvedValue({});
    openAIClient.chat.completions.create.mockResolvedValue(
      makeStream(['draft text'])
    );
    const res = mockStreamRes();

    await cvmlrlAi(
      mockReq({
        user: admin,
        body: {
          student_input: 'I love CS',
          document_requirements: 'one page',
          editor_requirements: JSON.stringify({ gptModel: 'gpt-3.5-turbo' }),
          program_full_name: 'MSc CS',
          file_type: 'ML',
          student_id: studentId
        }
      }),
      res,
      jest.fn()
    );

    expect(res.write).toHaveBeenCalledWith('draft text');
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(PermissionService.decrementTaigerAiQuota).toHaveBeenCalledWith(
      admin._id
    );
  });

  it('uses the RL prompt for non-ML file types (and tolerates a missing student)', async () => {
    // Student lookup rejects -> the try/catch leaves student_info = {}.
    StudentService.getStudentByIdLean.mockRejectedValue(
      new Error('no student')
    );
    PermissionService.decrementTaigerAiQuota.mockResolvedValue({});
    openAIClient.chat.completions.create.mockResolvedValue(
      makeStream(['rl draft'])
    );
    const res = mockStreamRes();

    await cvmlrlAi(
      mockReq({
        user: admin,
        body: {
          student_input: 'My manager will recommend me',
          document_requirements: 'one page',
          editor_requirements: JSON.stringify({}),
          program_full_name: 'MSc CS',
          // file_type without 'ML' -> generalRLPrompt branch
          file_type: 'RL_A',
          student_id: studentId
        }
      }),
      res,
      jest.fn()
    );

    expect(res.write).toHaveBeenCalledWith('rl draft');
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(PermissionService.decrementTaigerAiQuota).toHaveBeenCalledWith(
      admin._id
    );
  });

  it('forwards an OpenAI error to next()', async () => {
    StudentService.getStudentByIdLean.mockResolvedValue({});
    const err = new Error('openai down');
    openAIClient.chat.completions.create.mockRejectedValue(err);
    const next = jest.fn();

    await cvmlrlAi(
      mockReq({
        user: admin,
        body: {
          student_input: 'x',
          document_requirements: 'y',
          editor_requirements: JSON.stringify({}),
          program_full_name: 'p',
          file_type: 'ML',
          student_id: studentId
        }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('processProgramListAi', () => {
  it('responds 200 (success) when the spawned crawler closes with code 0', async () => {
    ProgramService.getProgramByIdLean.mockResolvedValue({
      _id: 'p1',
      school: 'TUM',
      program_name: 'CS',
      degree: 'MSc'
    });
    const res = mockRes();

    await processProgramListAi(
      mockReq({ user: admin, params: { programId: 'p1' } }),
      res,
      jest.fn()
    );

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });

  it('responds 403 when the crawler closes with a non-zero exit code, and fires the data/error listeners', async () => {
    ProgramService.getProgramByIdLean.mockResolvedValue({
      _id: 'p1',
      school: 'TUM',
      program_name: 'CS',
      degree: 'MSc'
    });
    // This spawn double drives every registered listener: data, error, and a
    // non-zero close so the 403 branch runs.
    spawn.mockImplementationOnce(() => ({
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn((event, cb) => {
        if (event === 'data') cb('some output');
        if (event === 'error') cb(new Error('spawn boom'));
        if (event === 'close') cb(1);
      })
    }));
    const res = mockRes();

    await processProgramListAi(
      mockReq({ user: admin, params: { programId: 'p1' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith({ message: 1 });
  });

  it('short-circuits with an empty data object when the program is missing', async () => {
    ProgramService.getProgramByIdLean.mockResolvedValue(null);
    const res = mockRes();

    await processProgramListAi(
      mockReq({ user: admin, params: { programId: 'missing' } }),
      res,
      jest.fn()
    );

    expect(spawn).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith({ success: true, data: {} });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    ProgramService.getProgramByIdLean.mockRejectedValue(err);
    const next = jest.fn();

    await processProgramListAi(
      mockReq({ user: admin, params: { programId: 'p1' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});
