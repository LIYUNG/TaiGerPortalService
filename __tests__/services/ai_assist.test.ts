jest.mock('../../database', () => ({
  getPostgresDb: jest.fn()
}));

jest.mock('../../services/openai', () => ({
  openAIClient: {
    responses: {
      create: jest.fn().mockResolvedValue({
        id: 'resp_test',
        output_text: 'mocked AI Assist answer',
        output: []
      })
    }
  },
  OpenAiModel: { GPT_4_o: 'gpt-4o' }
}));

jest.mock('../../utils/queryFunctions', () => ({
  getPermission: jest.fn()
}));

jest.mock('../../services/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn()
}));

import { Role } from '../../constants';
import { getPostgresDb } from '../../database';
import { openAIClient } from '../../services/openai';
import { getPermission } from '../../utils/queryFunctions';
import logger from '../../services/logger';
import {
  createConversation,
  archiveConversation,
  getConversation,
  listConversations,
  listRecentStudents,
  listMyStudents,
  sendMessage,
  sendFirstMessage,
  updateConversation,
  searchStudents
} from '../../controllers/ai_assist';
import StudentService from '../../services/students';
import ApplicationService from '../../services/applications';
import CommunicationService from '../../services/communications';
import ComplaintService from '../../services/complaints';
import { aiAssistConversations } from '../../drizzle/schema/schema';
import { getAccessibleStudentFilter } from '../../services/ai-assist/studentAccess';
import aiAssistTools from '../../services/ai-assist/tools';

const { runTool } = aiAssistTools;

const createResponse = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis()
  };
  return res;
};

const createSseResponse = () => ({
  status: jest.fn().mockReturnThis(),
  setHeader: jest.fn(),
  flushHeaders: jest.fn(),
  write: jest.fn(),
  end: jest.fn()
});

const conditionIncludesValue = (condition, expectedValue) => {
  const stack = [condition];

  while (stack.length) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }

    if (typeof current === 'object') {
      if (current.value === expectedValue) {
        return true;
      }

      if (current.queryChunks) {
        stack.push(...current.queryChunks);
      }
    }
  }

  return false;
};

const createLifecyclePostgres = (conversation) => {
  const insertedRows = [
    { id: 'msg_user', role: 'user', content: 'question' },
    {
      id: 'msg_assistant',
      role: 'assistant',
      content: 'mocked AI Assist answer'
    }
  ];
  let insertIndex = 0;
  const where = jest.fn((condition) => {
    const activeOnly = conditionIncludesValue(condition, 'active');
    const readRows = () =>
      activeOnly && conversation.status !== 'active' ? [] : [conversation];
    const limit = jest.fn().mockImplementation(async () => readRows());
    const orderBy = jest.fn(() => ({ limit }));

    return {
      limit,
      orderBy
    };
  });

  const postgres = {
    insert: jest.fn(() => ({
      values: jest.fn(() => ({
        returning: jest.fn().mockImplementation(() => {
          const row =
            insertedRows[insertIndex] || insertedRows[insertedRows.length - 1];
          insertIndex += 1;
          return Promise.resolve([row]);
        })
      }))
    })),
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where
      }))
    })),
    update: jest.fn(() => ({
      set: jest.fn((values) => ({
        where: jest.fn(() => ({
          returning: jest.fn().mockImplementation(async () => {
            if (conversation.status !== 'active') {
              return [];
            }

            Object.assign(conversation, values);
            conversation.updatedAt = values.updatedAt || new Date();
            return [conversation];
          })
        }))
      }))
    }))
  };

  postgres.transaction = jest.fn(async (callback) => callback(postgres));

  return postgres;
};

const createInsertReturningDb = (row) => ({
  insert: jest.fn(() => ({
    values: jest.fn(() => ({
      returning: jest.fn().mockResolvedValue([row])
    }))
  }))
});

const createStudentQuickStartReq = ({
  students = [],
  user = { _id: 'agent_1', role: Role.Agent }
} = {}) => {
  // listRecentStudents / listMyStudents / searchStudents read students through
  // StudentService.findStudentsSelect (default connection).
  jest.spyOn(StudentService, 'findStudentsSelect').mockResolvedValue(students);

  return {
    req: { user, query: {} }
  };
};

const createStudentAccessReq = ({
  students = [],
  user = { _id: 'agent_1', role: Role.Agent }
} = {}) => {
  // The ai-assist tools read students through the service/DAO layer; mirror the
  // id-filtering the legacy req.db.model('Student') mock did.
  const filterStudents = (filter = {}) => {
    const requestedIds = filter._id
      ? Array.isArray(filter._id.$in)
        ? filter._id.$in
        : [filter._id]
      : null;
    return requestedIds
      ? students.filter((student) => requestedIds.includes(student._id))
      : students;
  };

  jest
    .spyOn(StudentService, 'findStudentsSelect')
    .mockImplementation((filter) => Promise.resolve(filterStudents(filter)));
  jest
    .spyOn(StudentService, 'getStudentByIdSelect')
    .mockImplementation((id) =>
      Promise.resolve(students.find((s) => s._id === id) || null)
    );

  return {
    req: { user, query: {} }
  };
};

const createAiAssistReq = () => {
  const student = {
    _id: 'student_abby',
    firstname: 'abby',
    lastname: 'Student',
    firstname_chinese: '艾比',
    lastname_chinese: '學生',
    email: 'abbystudent@gmail.com',
    role: Role.Student,
    agents: ['agent_1'],
    editors: [],
    profile: [],
    applying_program_count: 10
  };
  const application = {
    _id: 'application_1',
    admission: 'pending',
    decided: 'O',
    closed: 'O',
    programId: {
      _id: 'program_1',
      school: 'TU Berlin',
      program_name: 'Computer Science',
      degree: 'MSc',
      semester: 'winter'
    }
  };
  const communication = {
    _id: 'message_1',
    message: 'Please upload the missing transcript.',
    createdAt: new Date('2026-04-01T10:00:00.000Z'),
    user_id: {
      firstname: 'Agent',
      lastname: 'Chen',
      role: Role.Agent
    },
    files: []
  };

  // ai-assist tools read through the service/DAO layer (default connection); the
  // request object only carries the authenticated user.
  jest.spyOn(StudentService, 'findStudentsSelect').mockResolvedValue([student]);
  jest.spyOn(StudentService, 'getStudentByIdSelect').mockResolvedValue(student);
  jest
    .spyOn(ApplicationService, 'findApplicationsSelectPopulate')
    .mockResolvedValue([application]);
  jest
    .spyOn(CommunicationService, 'findPopulatedSorted')
    .mockResolvedValue([communication]);
  jest.spyOn(ComplaintService, 'findComplaintsSelect').mockResolvedValue([]);

  return {
    req: {
      user: { _id: 'agent_1', role: Role.Agent }
    }
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  // The ai-assist tools read through the service/DAO layer (default connection).
  // Default every reader to empty so a tool never reaches the real model; each
  // test/helper overrides the relevant spy with its own fixtures.
  jest.spyOn(StudentService, 'findStudentsSelect').mockResolvedValue([]);
  jest.spyOn(StudentService, 'getStudentByIdSelect').mockResolvedValue(null);
  jest
    .spyOn(ApplicationService, 'findApplicationsSelectPopulate')
    .mockResolvedValue([]);
  jest.spyOn(CommunicationService, 'findPopulatedSorted').mockResolvedValue([]);
  jest.spyOn(ComplaintService, 'findComplaintsSelect').mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AI Assist Postgres persistence', () => {
  it('creates an owned conversation in Postgres', async () => {
    const conversation = {
      id: 'conv_1',
      ownerUserId: 'admin_1',
      ownerRole: Role.Admin,
      title: 'New AI Assist conversation',
      status: 'active'
    };
    getPostgresDb.mockReturnValue(createInsertReturningDb(conversation));

    const req = {
      user: { _id: 'admin_1', role: Role.Admin },
      body: {}
    };
    const res = createResponse();

    await createConversation(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: conversation
    });
  });

  it('ignores bound student metadata when creating a conversation', async () => {
    const conversation = {
      id: 'conv_1',
      ownerUserId: 'agent_1',
      ownerRole: Role.Agent,
      title: 'New AI Assist conversation',
      status: 'active'
    };
    getPostgresDb.mockReturnValue(createInsertReturningDb(conversation));
    const { req } = createStudentAccessReq({
      students: [
        {
          _id: 'student_abby',
          firstname: 'Abby',
          lastname: 'Student',
          email: 'abbystudent@gmail.com',
          role: Role.Student,
          agents: ['agent_1'],
          editors: [],
          applying_program_count: 10
        }
      ]
    });
    req.body = {
      studentId: 'student_other',
      studentDisplayName: 'Other Student'
    };
    const res = createResponse();

    await createConversation(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.send.mock.calls[0][0].data).not.toHaveProperty('studentId');
    expect(res.send.mock.calls[0][0].data).not.toHaveProperty(
      'studentDisplayName'
    );
  });

  it('creates a first-message conversation with message-level student context', async () => {
    const conversation = {
      id: 'conv_1',
      ownerUserId: 'agent_1',
      ownerRole: Role.Agent,
      title: 'New AI Assist conversation',
      status: 'active'
    };
    const insertedRows = [
      conversation,
      { id: 'msg_user', role: 'user', content: 'Summarize Abby' },
      {
        id: 'msg_assistant',
        role: 'assistant',
        content: 'mocked AI Assist answer'
      }
    ];
    let insertIndex = 0;
    const updateWhere = jest.fn(() => ({
      returning: jest.fn().mockResolvedValue([
        {
          ...conversation,
          updatedAt: new Date()
        }
      ])
    }));
    const updateSet = jest.fn(() => ({ where: updateWhere }));
    const selectResponses = [[conversation], [], []];
    let selectIndex = 0;
    const postgres = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          returning: jest.fn().mockImplementation(() => {
            const row = insertedRows[insertIndex];
            insertIndex += 1;
            return Promise.resolve([row]);
          })
        }))
      })),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => {
            const rows = selectResponses[selectIndex++] || [];
            return {
              limit: jest.fn().mockResolvedValue(rows),
              orderBy: jest.fn(() => ({
                limit: jest.fn().mockResolvedValue(rows)
              }))
            };
          })
        }))
      })),
      update: jest.fn(() => ({
        set: updateSet
      })),
      transaction: jest.fn(async (callback) => callback(postgres))
    };
    getPostgresDb.mockReturnValue(postgres);
    openAIClient.responses.create.mockResolvedValueOnce({
      id: 'resp_final',
      output_text: 'mocked AI Assist answer',
      output: []
    });
    const { req: aiAssistReq } = createAiAssistReq();
    const req = {
      user: { _id: 'agent_1', role: Role.Agent },
      body: {
        message: 'Summarize Abby',
        studentId: 'student_abby',
        studentDisplayName: 'abby Student',
        assistContext: {
          mentionedStudent: { id: 'student_abby', displayName: 'abby Student' },
          requestedSkill: 'summarize_student',
          unknownSkillText: null
        }
      },
      db: aiAssistReq.db
    };
    const res = createResponse();
    const runAiAssistSpy = jest.spyOn(
      require('../../services/ai-assist/orchestrator'),
      'runAiAssist'
    );

    await sendFirstMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(postgres.transaction).toHaveBeenCalledTimes(1);
    // conversation + user message + assistant message (no tool calls here).
    expect(postgres.insert).toHaveBeenCalledTimes(3);
    expect(res.send.mock.calls[0][0].data.conversation).toMatchObject({
      id: 'conv_1',
      status: 'active'
    });
    expect(res.send.mock.calls[0][0].data.answer).toBe(
      'mocked AI Assist answer'
    );
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        updatedAt: expect.any(Date),
        studentId: 'student_abby',
        studentDisplayName: 'abby Student'
      })
    );
    expect(runAiAssistSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        assistContext: expect.objectContaining({
          mentionedStudent: { id: 'student_abby', displayName: 'abby Student' },
          requestedSkill: 'summarize_student',
          unknownSkillText: null
        })
      })
    );
  });

  it('passes assistContext through sendMessage into runAiAssist', async () => {
    const conversation = {
      id: 'conv_1',
      ownerUserId: 'agent_1',
      ownerRole: Role.Agent,
      status: 'active'
    };
    const postgres = createLifecyclePostgres(conversation);
    getPostgresDb.mockReturnValue(postgres);
    const res = createResponse();
    const { req } = createAiAssistReq();
    req.params = { conversationId: 'conv_1' };
    req.user = { _id: 'agent_1', role: Role.Agent };
    req.body = {
      message: '@Abby Student #identify_risk',
      assistContext: {
        mentionedStudent: { id: 'student_abby', displayName: 'Abby Student' },
        requestedSkill: 'identify_risk',
        unknownSkillText: null
      }
    };
    const runAiAssistSpy = jest.spyOn(
      require('../../services/ai-assist/orchestrator'),
      'runAiAssist'
    );

    await sendMessage(req, res);

    expect(runAiAssistSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        assistContext: expect.objectContaining({
          mentionedStudent: { id: 'student_abby', displayName: 'Abby Student' },
          requestedSkill: 'identify_risk',
          unknownSkillText: null
        })
      })
    );
  });

  it('returns generic non-stream error response and logs warning for OpenAI failures', async () => {
    const conversation = {
      id: 'conv_1',
      ownerUserId: 'agent_1',
      ownerRole: Role.Agent,
      status: 'active'
    };
    const postgres = createLifecyclePostgres(conversation);
    getPostgresDb.mockReturnValue(postgres);
    openAIClient.responses.create.mockRejectedValueOnce({
      status: 401,
      error: {
        code: 'invalid_api_key',
        message: 'Incorrect API key provided'
      }
    });

    const { req } = createAiAssistReq();
    req.params = { conversationId: 'conv_1' };
    req.user = { _id: 'agent_1', role: Role.Agent };
    req.body = { message: 'What is the status?' };
    const res = createResponse();

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.send).toHaveBeenCalledWith({
      success: false,
      message: 'AI Assist is temporarily unavailable. Please try again.'
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('streams generic error message and logs warning for OpenAI quota failures', async () => {
    const conversation = {
      id: 'conv_1',
      ownerUserId: 'agent_1',
      ownerRole: Role.Agent,
      status: 'active'
    };
    const postgres = createLifecyclePostgres(conversation);
    getPostgresDb.mockReturnValue(postgres);
    openAIClient.responses.create.mockRejectedValueOnce({
      status: 429,
      error: {
        code: 'insufficient_quota',
        message: 'You exceeded your current quota.'
      }
    });

    const { req } = createAiAssistReq();
    req.params = { conversationId: 'conv_1' };
    req.user = { _id: 'agent_1', role: Role.Agent };
    req.body = { message: 'What is the status?' };
    req.query = { stream: '1' };
    req.headers = { accept: 'text/event-stream' };
    const res = createSseResponse();

    await sendMessage(req, res);

    const allWrites = res.write.mock.calls.map((call) => call[0]).join('');
    expect(allWrites).toContain('event: error');
    expect(allWrites).toContain(
      'AI Assist is temporarily unavailable. Please try again.'
    );
    // The streaming path now logs the full error via logger.error.
    expect(logger.error).toHaveBeenCalled();
  });

  it('rolls back first-message creation if persistence fails after insert', async () => {
    const conversation = {
      id: 'conv_1',
      ownerUserId: 'agent_1',
      ownerRole: Role.Agent,
      studentId: 'student_abby',
      studentDisplayName: 'Abby Student',
      title: 'New AI Assist conversation',
      status: 'active'
    };
    const insertedRows = [
      conversation,
      { id: 'msg_user', role: 'user', content: 'Summarize Abby' }
    ];
    let insertIndex = 0;
    const updateSet = jest.fn(() => ({
      where: jest.fn(() => ({
        returning: jest.fn().mockResolvedValue([
          {
            ...conversation,
            status: 'archived'
          }
        ])
      }))
    }));
    const selectResponses = [[conversation], [], []];
    let selectIndex = 0;
    const postgres = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          returning: jest.fn().mockImplementation(() => {
            const row = insertedRows[insertIndex];
            insertIndex += 1;
            return Promise.resolve([row]);
          })
        }))
      })),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => {
            const rows = selectResponses[selectIndex++] || [];
            return {
              limit: jest.fn().mockResolvedValue(rows),
              orderBy: jest.fn(() => ({
                limit: jest.fn().mockResolvedValue(rows)
              }))
            };
          })
        }))
      })),
      update: jest.fn(() => ({
        set: updateSet
      })),
      transaction: jest.fn(async (callback) => callback(postgres))
    };
    getPostgresDb.mockReturnValue(postgres);
    openAIClient.responses.create.mockRejectedValueOnce(
      new Error('model exploded')
    );
    const { req: aiAssistReq } = createAiAssistReq();
    const req = {
      user: { _id: 'agent_1', role: Role.Agent },
      body: {
        message: 'Summarize Abby',
        studentId: 'student_abby',
        studentDisplayName: 'abby Student'
      },
      db: aiAssistReq.db
    };
    const res = createResponse();

    await expect(sendFirstMessage(req, res)).rejects.toThrow('model exploded');

    expect(postgres.insert).toHaveBeenCalledTimes(2);
    expect(postgres.transaction).toHaveBeenCalledTimes(1);
    expect(updateSet).not.toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });

  it('ignores bound student fields on first-message conversations', async () => {
    const postgres = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          returning: jest
            .fn()
            .mockResolvedValue([{ id: 'conv_1', status: 'active' }])
        }))
      })),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue([{ id: 'conv_1' }]),
            orderBy: jest.fn(() => ({
              limit: jest.fn().mockResolvedValue([])
            }))
          }))
        }))
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            returning: jest.fn().mockResolvedValue([{ id: 'conv_1' }])
          }))
        }))
      })),
      transaction: jest.fn(async (callback) => callback(postgres))
    };
    getPostgresDb.mockReturnValue(postgres);
    openAIClient.responses.create.mockResolvedValueOnce({
      id: 'resp_final',
      output_text: 'mocked AI Assist answer',
      output: []
    });
    const { req: studentReq } = createAiAssistReq();
    const req = {
      user: { _id: 'agent_1', role: Role.Agent },
      body: {
        message: 'Summarize Abby',
        studentId: 'student_abby',
        studentDisplayName: 'Wrong Name'
      },
      db: studentReq.db
    };
    const res = createResponse();

    await sendFirstMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(postgres.transaction).toHaveBeenCalledTimes(1);
  });

  it('retries first-message conversation creation once on transient Postgres failure', async () => {
    const conversation = {
      id: 'conv_1',
      ownerUserId: 'agent_1',
      ownerRole: Role.Agent,
      studentId: 'student_abby',
      studentDisplayName: 'Abby Student',
      title: 'New AI Assist conversation',
      status: 'active'
    };
    const insertedRows = [
      conversation,
      { id: 'msg_user', role: 'user', content: 'Summarize Abby' },
      {
        id: 'msg_assistant',
        role: 'assistant',
        content: 'mocked AI Assist answer'
      }
    ];
    const insertedValues = [];
    let insertIndex = 0;
    const returning = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('Failed query: insert into ai_assist'), {
          cause: { code: '08006' }
        })
      )
      .mockImplementation(() => Promise.resolve([insertedRows[insertIndex++]]));
    const values = jest.fn((valuesToInsert) => {
      insertedValues.push(valuesToInsert);
      return { returning };
    });
    const insert = jest.fn(() => ({ values }));
    const selectResponses = [[conversation], [], []];
    let selectIndex = 0;
    const postgres = {
      insert,
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => {
            const rows = selectResponses[selectIndex++] || [];
            return {
              limit: jest.fn().mockResolvedValue(rows),
              orderBy: jest.fn(() => ({
                limit: jest.fn().mockResolvedValue(rows)
              }))
            };
          })
        }))
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            returning: jest.fn().mockResolvedValue([
              {
                ...conversation,
                updatedAt: new Date()
              }
            ])
          }))
        }))
      })),
      transaction: jest.fn(async (callback) => callback(postgres))
    };
    getPostgresDb.mockReturnValue(postgres);
    openAIClient.responses.create.mockResolvedValueOnce({
      id: 'resp_final',
      output_text: 'mocked AI Assist answer',
      output: []
    });
    const { req: aiAssistReq } = createAiAssistReq();
    const req = {
      user: { _id: 'agent_1', role: Role.Agent },
      body: {
        message: 'Summarize Abby',
        studentId: 'student_abby',
        studentDisplayName: 'abby Student'
      },
      db: aiAssistReq.db
    };
    const res = createResponse();

    await sendFirstMessage(req, res);

    expect(insertedValues[0]).not.toHaveProperty('studentId');
    expect(insertedValues[0]).not.toHaveProperty('studentDisplayName');
    expect(insertedValues[1]).not.toHaveProperty('studentId');
    expect(insertedValues[1]).not.toHaveProperty('studentDisplayName');
    expect(insertedValues[2]).toMatchObject({
      conversationId: 'conv_1',
      role: 'user'
    });
    expect(postgres.transaction).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('retries conversation creation once when Postgres has a transient connection failure', async () => {
    const conversation = {
      id: 'conv_1',
      ownerUserId: 'admin_1',
      ownerRole: Role.Admin,
      title: 'New AI Assist conversation',
      status: 'active'
    };
    const returning = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('Failed query: insert into ai_assist'), {
          cause: { code: '08006' }
        })
      )
      .mockResolvedValueOnce([conversation]);
    const values = jest.fn(() => ({ returning }));
    const insert = jest.fn(() => ({ values }));
    getPostgresDb.mockReturnValue({ insert });

    const req = {
      user: { _id: 'admin_1', role: Role.Admin },
      body: {}
    };
    const res = createResponse();

    await createConversation(req, res);

    expect(returning).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('does not retry conversation creation when the AI Assist table is missing', async () => {
    const returning = jest.fn().mockRejectedValue(
      Object.assign(new Error('Failed query: insert into ai_assist'), {
        cause: { code: '42P01' }
      })
    );
    const values = jest.fn(() => ({ returning }));
    const insert = jest.fn(() => ({ values }));
    getPostgresDb.mockReturnValue({ insert });

    const req = {
      user: { _id: 'admin_1', role: Role.Admin },
      body: {}
    };
    const res = createResponse();

    await expect(createConversation(req, res)).rejects.toThrow('Failed query');

    expect(returning).toHaveBeenCalledTimes(1);
  });

  it('returns an owned conversation with persisted messages and trace', async () => {
    const conversation = {
      id: 'conv_1',
      ownerUserId: 'admin_1',
      ownerRole: Role.Admin,
      title: 'New AI Assist conversation',
      status: 'active'
    };
    const messages = [
      {
        id: 'msg_user',
        conversationId: 'conv_1',
        role: 'user',
        content: 'Find my students'
      },
      {
        id: 'msg_assistant',
        conversationId: 'conv_1',
        role: 'assistant',
        content: 'mocked AI Assist answer'
      }
    ];
    const trace = [
      {
        id: 'trace_1',
        conversationId: 'conv_1',
        assistantMessageId: 'msg_assistant',
        toolName: 'search_accessible_students',
        status: 'success'
      }
    ];
    const limit = jest.fn().mockResolvedValue([conversation]);
    const orderBy = jest
      .fn()
      .mockResolvedValueOnce(messages)
      .mockResolvedValueOnce(trace);
    const postgres = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit,
            orderBy
          }))
        }))
      }))
    };
    getPostgresDb.mockReturnValue(postgres);
    const req = {
      params: { conversationId: 'conv_1' },
      user: { _id: 'admin_1', role: Role.Admin }
    };
    const res = createResponse();

    await getConversation(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(orderBy).toHaveBeenCalledTimes(2);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: {
        conversation,
        messages,
        trace
      }
    });
  });

  it('rejects conversation detail access when the user is not the owner', async () => {
    const postgres = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue([])
          }))
        }))
      }))
    };
    getPostgresDb.mockReturnValue(postgres);
    const req = {
      params: { conversationId: 'conv_1' },
      user: { _id: 'agent_1', role: Role.Agent }
    };
    const res = createResponse();

    await expect(getConversation(req, res)).rejects.toThrow(
      'AI Assist conversation not found'
    );
  });

  it('archives a conversation and treats archived conversations as not found', async () => {
    const conversation = {
      id: 'conv_1',
      ownerUserId: 'admin_1',
      ownerRole: Role.Admin,
      title: 'New AI Assist conversation',
      status: 'active'
    };
    const postgres = createLifecyclePostgres(conversation);
    getPostgresDb.mockReturnValue(postgres);
    const req = {
      params: { conversationId: 'conv_1' },
      user: { _id: 'admin_1', role: Role.Admin }
    };
    const res = createResponse();

    await archiveConversation(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send.mock.calls[0][0].data).toMatchObject({
      id: 'conv_1',
      status: 'archived'
    });

    const archivedGetReq = {
      params: { conversationId: 'conv_1' },
      user: { _id: 'admin_1', role: Role.Admin }
    };
    const archivedUpdateReq = {
      params: { conversationId: 'conv_1' },
      body: { title: 'Still archived' },
      user: { _id: 'admin_1', role: Role.Admin }
    };
    const archivedSendReq = {
      params: { conversationId: 'conv_1' },
      body: { message: 'hello' },
      user: { _id: 'admin_1', role: Role.Admin },
      db: {
        model: jest.fn()
      }
    };

    await expect(
      getConversation(archivedGetReq, createResponse())
    ).rejects.toThrow('AI Assist conversation not found');
    await expect(
      updateConversation(archivedUpdateReq, createResponse())
    ).rejects.toThrow('AI Assist conversation not found');
    await expect(
      sendMessage(archivedSendReq, createResponse())
    ).rejects.toThrow('AI Assist conversation not found');

    const listRes = createResponse();
    await listConversations(
      {
        user: { _id: 'admin_1', role: Role.Admin }
      },
      listRes
    );
    expect(listRes.send).toHaveBeenCalledWith({
      success: true,
      data: []
    });
  });

  it('returns recent accessible students from active AI Assist conversations without duplicates', async () => {
    getPermission.mockResolvedValue({});
    const conversationRows = [
      {
        id: 'conv_1',
        studentId: 'student_abby',
        studentDisplayName: 'Abby Student',
        updatedAt: new Date('2026-04-12T10:00:00.000Z'),
        status: 'active'
      },
      {
        id: 'conv_2',
        studentId: 'student_abby',
        studentDisplayName: 'Abby Student',
        updatedAt: new Date('2026-04-11T10:00:00.000Z'),
        status: 'active'
      },
      {
        id: 'conv_3',
        studentId: 'student_bob',
        studentDisplayName: 'Bob Student',
        updatedAt: new Date('2026-04-10T10:00:00.000Z'),
        status: 'active'
      },
      {
        id: 'conv_4',
        studentId: null,
        updatedAt: new Date('2026-04-09T10:00:00.000Z'),
        status: 'active'
      }
    ];
    const selectCalls = [];
    const postgres = {
      select: jest.fn(() => {
        const callIndex = selectCalls.length;
        selectCalls.push(callIndex);

        if (callIndex === 0) {
          return {
            from: jest.fn(() => ({
              where: jest.fn(() => ({
                orderBy: jest.fn(() => ({
                  offset: jest.fn(() => ({
                    limit: jest.fn().mockResolvedValue(conversationRows)
                  })),
                  limit: jest.fn().mockResolvedValue(conversationRows)
                }))
              }))
            }))
          };
        }

        return {
          from: jest.fn(() => ({
            where: jest.fn(() => ({
              limit: jest.fn().mockResolvedValue([
                {
                  _id: 'student_abby',
                  firstname: 'abby',
                  lastname: 'Student',
                  firstname_chinese: 'è‰¾æ¯”',
                  lastname_chinese: 'å­¸ç”Ÿ',
                  email: 'abbystudent@gmail.com',
                  role: Role.Student,
                  agents: ['agent_1'],
                  editors: [],
                  applying_program_count: 10
                },
                {
                  _id: 'student_bob',
                  firstname: 'Bob',
                  lastname: 'Student',
                  email: 'bob@example.com',
                  role: Role.Student,
                  agents: ['agent_1'],
                  editors: [],
                  applying_program_count: 2
                }
              ])
            }))
          }))
        };
      })
    };
    getPostgresDb.mockReturnValue(postgres);
    const { req } = createStudentQuickStartReq({
      students: [
        {
          _id: 'student_abby',
          firstname: 'abby',
          lastname: 'Student',
          firstname_chinese: 'è‰¾æ¯”',
          lastname_chinese: 'å­¸ç”Ÿ',
          email: 'abbystudent@gmail.com',
          role: Role.Student,
          agents: ['agent_1'],
          editors: [],
          applying_program_count: 10
        },
        {
          _id: 'student_bob',
          firstname: 'Bob',
          lastname: 'Student',
          email: 'bob@example.com',
          role: Role.Student,
          agents: ['agent_1'],
          editors: [],
          applying_program_count: 2
        }
      ]
    });
    const res = createResponse();

    await listRecentStudents(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send.mock.calls[0][0].data).toHaveLength(2);
    expect(res.send.mock.calls[0][0].data[0]).toMatchObject({
      id: 'student_abby',
      name: 'abby Student',
      email: 'abbystudent@gmail.com'
    });
    expect(res.send.mock.calls[0][0].data[1]).toMatchObject({
      id: 'student_bob',
      name: 'Bob Student',
      email: 'bob@example.com'
    });
    expect(StudentService.findStudentsSelect).toHaveBeenCalledWith(
      {
        $or: [{ archiv: { $exists: false } }, { archiv: false }],
        agents: 'agent_1',
        _id: { $in: ['student_abby', 'student_bob'] }
      },
      expect.any(String),
      2
    );
  });

  it('keeps fetching recent conversations until 25 unique students are collected', async () => {
    getPermission.mockResolvedValue({});
    const duplicateRows = Array.from({ length: 35 }, (_, index) => ({
      id: `conv_dup_${index}`,
      studentId: index % 2 === 0 ? 'student_dup_1' : 'student_dup_2',
      studentDisplayName: index % 2 === 0 ? 'Duplicate One' : 'Duplicate Two',
      updatedAt: new Date(
        `2026-04-12T10:${String(index).padStart(2, '0')}:00.000Z`
      ),
      status: 'active'
    }));
    const uniqueRows = Array.from({ length: 30 }, (_, index) => ({
      id: `conv_unique_${index + 1}`,
      studentId: `student_${String(index + 1).padStart(2, '0')}`,
      studentDisplayName: `Student ${index + 1}`,
      updatedAt: new Date(
        `2026-04-11T10:${String(index).padStart(2, '0')}:00.000Z`
      ),
      status: 'active'
    }));
    const conversationRows = [...duplicateRows, ...uniqueRows];
    const selectCalls = [];
    const postgres = {
      select: jest.fn(() => {
        selectCalls.push(selectCalls.length);
        return {
          from: jest.fn(() => ({
            where: jest.fn(() => ({
              orderBy: jest.fn(() => ({
                offset: jest.fn((offsetValue) => ({
                  limit: jest
                    .fn()
                    .mockResolvedValue(
                      conversationRows.slice(offsetValue, offsetValue + 50)
                    )
                }))
              }))
            }))
          }))
        };
      })
    };
    getPostgresDb.mockReturnValue(postgres);
    const { req } = createStudentQuickStartReq({
      students: [
        {
          _id: 'student_dup_1',
          firstname: 'Duplicate',
          lastname: 'One',
          role: Role.Student
        },
        {
          _id: 'student_dup_2',
          firstname: 'Duplicate',
          lastname: 'Two',
          role: Role.Student
        },
        ...Array.from({ length: 30 }, (_, index) => ({
          _id: `student_${String(index + 1).padStart(2, '0')}`,
          firstname: 'Student',
          lastname: String(index + 1),
          role: Role.Student,
          agents: ['agent_1'],
          editors: [],
          applying_program_count: index + 1
        }))
      ]
    });
    const res = createResponse();

    await listRecentStudents(req, res);

    expect(selectCalls.length).toBeGreaterThan(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send.mock.calls[0][0].data).toHaveLength(25);
    expect(res.send.mock.calls[0][0].data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'student_23' })])
    );
  });

  it('returns lightweight accessible my-student picker rows', async () => {
    getPermission.mockResolvedValue({});
    const students = [
      {
        _id: 'student_abby',
        firstname: 'Abby',
        lastname: 'Student',
        firstname_chinese: 'è‰¾æ¯”',
        lastname_chinese: 'å­¸ç”Ÿ',
        email: 'abbystudent@gmail.com',
        role: Role.Student,
        agents: ['agent_1'],
        editors: [],
        applying_program_count: 10
      }
    ];
    const { req } = createStudentQuickStartReq({ students });
    const res = createResponse();

    await listMyStudents(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: [
        expect.objectContaining({
          id: 'student_abby',
          name: 'Abby Student',
          email: 'abbystudent@gmail.com',
          applyingProgramCount: 10
        })
      ]
    });
    expect(StudentService.findStudentsSelect).toHaveBeenCalledWith(
      {
        $or: [{ archiv: { $exists: false } }, { archiv: false }],
        agents: 'agent_1'
      },
      expect.any(String),
      25
    );
  });

  it('returns searchable students in the lightweight HTTP form', async () => {
    getPermission.mockResolvedValue({});
    const students = [
      {
        _id: 'student_abby',
        firstname: 'Abby',
        lastname: 'Student',
        email: 'abbystudent@gmail.com',
        role: Role.Student,
        agents: ['agent_1'],
        editors: [],
        applying_program_count: 10
      }
    ];
    const { req } = createStudentQuickStartReq({ students });
    req.query = { q: 'Abby', limit: '5' };
    const res = createResponse();

    await searchStudents(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: [
        expect.objectContaining({
          id: 'student_abby',
          name: 'Abby Student',
          email: 'abbystudent@gmail.com'
        })
      ]
    });
    expect(StudentService.findStudentsSelect).toHaveBeenCalledWith(
      {
        $or: [{ archiv: { $exists: false } }, { archiv: false }],
        agents: 'agent_1',
        $text: { $search: 'Abby' }
      },
      expect.any(String),
      expect.anything()
    );
  });

  it('rejects sendMessage when the guarded write updates no rows after the pre-check passes', async () => {
    openAIClient.responses.create.mockResolvedValueOnce({
      id: 'resp_final',
      output_text: 'mocked AI Assist answer',
      output: []
    });
    const conversation = {
      id: 'conv_1',
      ownerUserId: 'agent_1',
      ownerRole: Role.Agent,
      status: 'active'
    };
    const postgres = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          returning: jest
            .fn()
            .mockResolvedValue([
              { id: 'msg_user', role: 'user', content: 'Find my students' }
            ])
        }))
      })),
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue([conversation]),
            orderBy: jest.fn(() => ({
              limit: jest.fn().mockResolvedValue([])
            }))
          }))
        }))
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            returning: jest.fn().mockResolvedValue([])
          }))
        }))
      })),
      transaction: jest.fn(async (callback) => callback(postgres))
    };
    getPostgresDb.mockReturnValue(postgres);
    const req = {
      params: { conversationId: 'conv_1' },
      user: { _id: 'agent_1', role: Role.Agent },
      body: { message: 'Find my students' },
      db: {
        model: jest.fn(() => ({
          find: jest.fn(() => ({
            select: jest.fn(() => ({
              limit: jest.fn(() => ({
                lean: jest.fn().mockResolvedValue([])
              }))
            }))
          }))
        }))
      }
    };
    const res = createResponse();

    await expect(sendMessage(req, res)).rejects.toThrow(
      'AI Assist conversation not found'
    );

    expect(postgres.transaction).toHaveBeenCalledTimes(1);
    expect(res.send).not.toHaveBeenCalled();
  });

  it('updates an owned conversation title', async () => {
    const renamedConversation = {
      id: 'conv_1',
      ownerUserId: 'admin_1',
      ownerRole: Role.Admin,
      title: 'Abby message review',
      status: 'active'
    };
    const returning = jest.fn().mockResolvedValue([renamedConversation]);
    const updateWhere = jest.fn(() => ({ returning }));
    const updateSet = jest.fn(() => ({ where: updateWhere }));
    const postgres = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue([
              {
                id: 'conv_1',
                ownerUserId: 'admin_1',
                ownerRole: Role.Admin,
                title: 'New AI Assist conversation',
                status: 'active'
              }
            ])
          }))
        }))
      })),
      update: jest.fn(() => ({
        set: updateSet
      }))
    };
    getPostgresDb.mockReturnValue(postgres);
    const req = {
      params: { conversationId: 'conv_1' },
      body: { title: '  Abby message review  ' },
      user: { _id: 'admin_1', role: Role.Admin }
    };
    const res = createResponse();

    await updateConversation(req, res);

    expect(updateSet).toHaveBeenCalledWith({
      title: 'Abby message review',
      titleAutoGenerated: false,
      titleUpdatedByUser: true,
      updatedAt: expect.any(Date)
    });
    expect(returning).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: renamedConversation
    });
  });

  it('sends a message and persists an assistant trace record', async () => {
    openAIClient.responses.create
      .mockResolvedValueOnce({
        id: 'resp_tool',
        output_text: '',
        output: [
          {
            type: 'function_call',
            call_id: 'call_search',
            name: 'find_students',
            arguments: JSON.stringify({ query: 'Abby', limit: 10 })
          }
        ]
      })
      .mockResolvedValueOnce({
        id: 'resp_final',
        output_text: 'mocked AI Assist answer',
        output: []
      });
    const insertedRows = [
      { id: 'msg_user', role: 'user', content: 'Find my students' },
      {
        id: 'msg_assistant',
        role: 'assistant',
        content: 'mocked AI Assist answer'
      },
      {
        id: 'trace_1',
        toolName: 'find_students',
        status: 'success'
      }
    ];
    let insertIndex = 0;
    const updateReturning = jest.fn().mockResolvedValue([
      {
        id: 'conv_1',
        ownerUserId: 'agent_1',
        ownerRole: Role.Agent,
        status: 'active'
      }
    ]);
    const updateWhere = jest.fn(() => ({ returning: updateReturning }));
    const updateSet = jest.fn(() => ({ where: updateWhere }));
    const insertedValues = [];
    let selectIndex = 0;
    const postgres = {
      insert: jest.fn(() => ({
        values: jest.fn((values) => {
          insertedValues.push(values);
          return {
            returning: jest.fn().mockImplementation(() => {
              const row = insertedRows[insertIndex];
              insertIndex += 1;
              return Promise.resolve([row]);
            })
          };
        })
      })),
      update: jest.fn(() => ({
        set: updateSet
      })),
      transaction: jest.fn(async (callback) => callback(postgres)),
      select: jest.fn(() => ({
        from: jest.fn((table) => {
          selectIndex++;
          if (table === aiAssistConversations) {
            // No bound studentId: the active student is resolved from the
            // find_students tool result instead.
            return {
              where: jest.fn(() => ({
                limit: jest.fn().mockResolvedValue([
                  {
                    id: 'conv_1',
                    ownerUserId: 'agent_1',
                    ownerRole: Role.Agent,
                    status: 'active'
                  }
                ])
              }))
            };
          }

          return {
            where: jest.fn(() => ({
              orderBy: jest.fn(() => ({
                limit: jest.fn().mockResolvedValue([])
              }))
            }))
          };
        })
      }))
    };
    getPostgresDb.mockReturnValue(postgres);
    const lean = jest.fn().mockResolvedValue([
      {
        _id: 'student_1',
        firstname: 'abby',
        lastname: 'Student',
        firstname_chinese: '艾比',
        lastname_chinese: '學生',
        email: 'ada@example.com',
        role: Role.Student,
        agents: ['agent_1'],
        editors: []
      }
    ]);
    const limit = jest.fn(() => ({ lean }));
    const select = jest.fn(() => ({ limit }));
    const find = jest.fn(() => ({ select }));
    StudentService.findStudentsSelect.mockResolvedValue([
      {
        _id: 'student_1',
        firstname: 'abby',
        lastname: 'Student',
        firstname_chinese: '艾比',
        lastname_chinese: '學生',
        email: 'ada@example.com',
        role: Role.Student,
        agents: ['agent_1'],
        editors: []
      }
    ]);

    const req = {
      params: { conversationId: 'conv_1' },
      user: { _id: 'agent_1', role: Role.Agent },
      body: { message: 'Find Abby' },
      db: {
        model: jest.fn(() => ({ find }))
      }
    };
    const res = createResponse();

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(postgres.transaction).toHaveBeenCalledTimes(1);
    expect(res.send.mock.calls[0][0].data.answer).toContain(
      'mocked AI Assist answer'
    );
    expect(res.send.mock.calls[0][0].data.trace[0]).toMatchObject({
      toolName: 'find_students',
      status: 'success'
    });
    expect(openAIClient.responses.create).toHaveBeenCalledTimes(2);
    expect(
      openAIClient.responses.create.mock.calls[0][0].instructions
    ).toContain('TaiGer AI Assist');
    expect(insertedValues[2].arguments).toEqual({
      query: 'Abby',
      limit: 10
    });
    expect(postgres.update).toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        updatedAt: expect.any(Date),
        studentId: 'student_1',
        studentDisplayName: 'abby Student'
      })
    );
    expect(updateWhere).toHaveBeenCalled();
    expect(updateReturning).toHaveBeenCalled();
    expect(StudentService.findStudentsSelect).toHaveBeenCalled();
  });
});

describe('AI Assist student access filters', () => {
  it('returns active student filter for Admin', async () => {
    await expect(
      getAccessibleStudentFilter({ user: { role: Role.Admin, _id: 'admin_1' } })
    ).resolves.toEqual({
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });
  });

  it('restricts Agent to assigned students by default', async () => {
    getPermission.mockResolvedValue({});

    await expect(
      getAccessibleStudentFilter({ user: { role: Role.Agent, _id: 'agent_1' } })
    ).resolves.toEqual({
      $or: [{ archiv: { $exists: false } }, { archiv: false }],
      agents: 'agent_1'
    });
  });

  it('allows Agent with canAccessAllChat to read active students', async () => {
    getPermission.mockResolvedValue({ canAccessAllChat: true });

    await expect(
      getAccessibleStudentFilter({ user: { role: Role.Agent, _id: 'agent_1' } })
    ).resolves.toEqual({
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });
  });
});

describe('AI Assist read-only tools', () => {
  it('search_accessible_students queries students with the current Agent filter', async () => {
    getPermission.mockResolvedValue({});
    StudentService.findStudentsSelect.mockResolvedValue([
      {
        _id: 'student_1',
        firstname: 'Ada',
        lastname: 'Lovelace',
        email: 'ada@example.com',
        role: Role.Student,
        agents: ['agent_1'],
        editors: [],
        applying_program_count: 2
      }
    ]);
    const req = {
      user: { role: Role.Agent, _id: 'agent_1' }
    };

    const result = await runTool(req, 'search_accessible_students', {
      query: 'Ada',
      limit: 5
    });

    expect(StudentService.findStudentsSelect).toHaveBeenCalledWith(
      {
        $or: [{ archiv: { $exists: false } }, { archiv: false }],
        agents: 'agent_1',
        $text: { $search: 'Ada' }
      },
      expect.any(String),
      5
    );
    expect(result.data[0]).toMatchObject({
      id: 'student_1',
      name: 'Ada Lovelace',
      email: 'ada@example.com'
    });
  });

  it('rejects inaccessible students in student-scoped tools', async () => {
    getPermission.mockResolvedValue({});
    const student = {
      _id: 'student_other',
      firstname: 'Other',
      lastname: 'Student',
      email: 'other@example.com',
      role: Role.Student,
      agents: [],
      editors: [],
      profile: [],
      applying_program_count: 1
    };
    const studentModel = {
      find: jest.fn(() => ({
        select: jest.fn(() => ({
          limit: jest.fn(() => ({
            lean: jest.fn().mockResolvedValue([])
          }))
        }))
      })),
      findById: jest.fn(() => ({
        select: jest.fn(() => ({
          populate: jest.fn(() => ({
            lean: jest.fn().mockResolvedValue(student)
          })),
          lean: jest.fn().mockResolvedValue(student)
        }))
      }))
    };
    const applicationModel = {
      find: jest.fn(() => ({
        select: jest.fn(() => ({
          populate: jest.fn(() => ({
            lean: jest.fn().mockResolvedValue([])
          }))
        }))
      }))
    };
    const communicationModel = {
      find: jest.fn(() => ({
        populate: jest.fn(() => ({
          sort: jest.fn(() => ({
            limit: jest.fn(() => ({
              lean: jest.fn().mockResolvedValue([])
            }))
          }))
        }))
      }))
    };
    const complaintModel = {
      find: jest.fn(() => ({
        select: jest.fn(() => ({
          limit: jest.fn(() => ({
            lean: jest.fn().mockResolvedValue([])
          }))
        }))
      }))
    };
    const req = {
      user: { role: Role.Agent, _id: 'agent_1' },
      db: {
        model: jest.fn((name) => {
          const model = {
            Student: studentModel,
            Application: applicationModel,
            Communication: communicationModel,
            Complaint: complaintModel
          }[name];

          if (!model) {
            throw new Error(`Unexpected model: ${name}`);
          }

          return model;
        })
      }
    };

    await expect(
      runTool(req, 'get_student_summary', { studentId: 'student_other' })
    ).rejects.toThrow();
    await expect(
      runTool(req, 'get_student_applications', { studentId: 'student_other' })
    ).rejects.toThrow();
    await expect(
      runTool(req, 'get_latest_communications', { studentId: 'student_other' })
    ).rejects.toThrow();
    await expect(
      runTool(req, 'get_profile_documents', { studentId: 'student_other' })
    ).rejects.toThrow();
    await expect(
      runTool(req, 'get_admissions_overview', { studentId: 'student_other' })
    ).rejects.toThrow();
  });

  it('get_student_applications returns application and program facts', async () => {
    const student = {
      _id: 'student_1',
      firstname: 'Ada',
      lastname: 'Lovelace',
      email: 'ada@example.com',
      role: Role.Student,
      agents: ['agent_1'],
      editors: [],
      profile: [],
      applying_program_count: 2
    };
    StudentService.findStudentsSelect.mockResolvedValue([student]);
    ApplicationService.findApplicationsSelectPopulate.mockResolvedValue([
      {
        _id: 'application_1',
        admission: 'pending',
        decided: 'O',
        closed: 'O',
        uni_assist: { status: 'not_started' },
        programId: {
          _id: 'program_1',
          school: 'TU Berlin',
          program_name: 'Computer Science',
          degree: 'MSc',
          semester: 'winter',
          application_deadline: new Date('2026-07-15')
        }
      }
    ]);
    const req = {
      user: { role: Role.Admin, _id: 'admin_1' }
    };

    const result = await runTool(req, 'get_student_applications', {
      studentId: 'student_1'
    });

    expect(
      ApplicationService.findApplicationsSelectPopulate
    ).toHaveBeenCalledWith(
      { studentId: 'student_1' },
      expect.any(String),
      expect.anything()
    );
    expect(result.data[0]).toMatchObject({
      id: 'application_1',
      admission: 'pending',
      program: {
        id: 'program_1',
        school: 'TU Berlin',
        name: 'Computer Science'
      }
    });
  });

  it('get_recent_communication_context applies 30-day filter for recent skill mode', async () => {
    const student = {
      _id: 'student_1',
      firstname: 'Ada',
      lastname: 'Lovelace',
      email: 'ada@example.com',
      role: Role.Student,
      agents: ['agent_1'],
      editors: [],
      profile: [],
      applying_program_count: 2
    };
    StudentService.findStudentsSelect.mockResolvedValue([student]);
    CommunicationService.findPopulatedSorted.mockResolvedValue([]);
    const req = {
      user: { role: Role.Admin, _id: 'admin_1' }
    };

    await runTool(req, 'get_recent_communication_context', {
      studentId: 'student_1',
      days: 30
    });

    const calledQuery =
      CommunicationService.findPopulatedSorted.mock.calls[0][0];
    expect(calledQuery.student_id).toBe('student_1');
    expect(calledQuery.createdAt).toBeDefined();
    expect(calledQuery.createdAt.$gte instanceof Date).toBe(true);
  });

  it('get_all_communication_context does not apply date filter and honors cap', async () => {
    const student = {
      _id: 'student_1',
      firstname: 'Ada',
      lastname: 'Lovelace',
      email: 'ada@example.com',
      role: Role.Student,
      agents: ['agent_1'],
      editors: [],
      profile: [],
      applying_program_count: 2
    };
    StudentService.findStudentsSelect.mockResolvedValue([student]);
    CommunicationService.findPopulatedSorted.mockResolvedValue([]);
    const req = {
      user: { role: Role.Admin, _id: 'admin_1' }
    };

    await runTool(req, 'get_all_communication_context', {
      studentId: 'student_1',
      limit: 999
    });

    const [calledQuery, calledOptions] =
      CommunicationService.findPopulatedSorted.mock.calls[0];
    expect(calledQuery).toEqual({ student_id: 'student_1' });
    expect(calledOptions.limit).toBe(200);
  });
});

describe('AI Assist CRM lead meeting access', () => {
  const baseStudent = {
    _id: 'student_1',
    firstname: 'Ada',
    lastname: 'Lovelace',
    email: 'ada@example.com',
    role: Role.Student,
    agents: ['agent_1'],
    editors: ['editor_1'],
    profile: [],
    applying_program_count: 2
  };

  const buildReq = (role, userId) => {
    // CRM lead access reads the student through the service/DAO layer now.
    StudentService.findStudentsSelect.mockResolvedValue([baseStudent]);
    StudentService.getStudentByIdSelect.mockResolvedValue(baseStudent);
    return {
      user: { role, _id: userId }
    };
  };

  it('allows Admin to read student lead meetings', async () => {
    const leadLimit = jest.fn().mockResolvedValue([
      {
        id: 'lead_1',
        fullName: 'Ada Lead',
        status: 'active'
      }
    ]);
    const meetingsLimit = jest.fn().mockResolvedValue([]);
    getPostgresDb.mockReturnValue({
      select: jest
        .fn()
        .mockImplementationOnce(() => ({
          from: jest.fn(() => ({
            where: jest.fn(() => ({ limit: leadLimit }))
          }))
        }))
        .mockImplementationOnce(() => ({
          from: jest.fn(() => ({
            where: jest.fn(() => ({
              orderBy: jest.fn(() => ({ limit: meetingsLimit }))
            }))
          }))
        }))
    });

    const result = await runTool(
      buildReq(Role.Admin, 'admin_1'),
      'get_crm_lead_meeting_context',
      {
        studentId: 'student_1'
      }
    );

    expect(result.data.lead).toMatchObject({ id: 'lead_1' });
  });

  it('denies Agent when not assigned as student agent/editor', async () => {
    const unassignedReq = buildReq(Role.Agent, 'agent_other');
    await expect(
      runTool(unassignedReq, 'get_crm_lead_meeting_context', {
        studentId: 'student_1'
      })
    ).rejects.toThrow();
  });
});
