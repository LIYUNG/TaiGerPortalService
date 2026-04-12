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

const { Role } = require('../../constants');
const { getPostgresDb } = require('../../database');
const { openAIClient } = require('../../services/openai');
const { getPermission } = require('../../utils/queryFunctions');
const {
  createConversation,
  getConversation,
  sendMessage
} = require('../../controllers/ai_assist');
const {
  getAccessibleStudentFilter
} = require('../../services/ai-assist/studentAccess');
const { runAiAssist } = require('../../services/ai-assist/orchestrator');
const { runTool } = require('../../services/ai-assist/tools');

const createResponse = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis()
  };
  return res;
};

const createInsertReturningDb = (row) => ({
  insert: jest.fn(() => ({
    values: jest.fn(() => ({
      returning: jest.fn().mockResolvedValue([row])
    }))
  }))
});

const createAiAssistPostgres = () => {
  const insertedValues = [];
  let insertIndex = 0;
  const insertedRows = [
    { id: 'msg_user', role: 'user', content: 'question' },
    {
      id: 'msg_assistant',
      role: 'assistant',
      content: 'mocked AI Assist answer'
    },
    { id: 'trace_search', toolName: 'search_accessible_students' },
    { id: 'trace_summary', toolName: 'get_student_summary' },
    { id: 'trace_applications', toolName: 'get_student_applications' },
    { id: 'trace_messages', toolName: 'get_latest_communications' }
  ];

  return {
    insertedValues,
    postgres: {
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
      }))
    }
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
    agents: [],
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
  const studentModel = {
    find: jest.fn(() => ({
      select: jest.fn(() => ({
        limit: jest.fn(() => ({
          lean: jest.fn().mockResolvedValue([student])
        }))
      }))
    })),
    findById: jest.fn(() => ({
      select: jest.fn(() => ({
        populate: jest.fn(() => ({
          lean: jest.fn().mockResolvedValue(student)
        }))
      }))
    }))
  };
  const applicationModel = {
    find: jest.fn(() => ({
      select: jest.fn(() => ({
        populate: jest.fn(() => ({
          lean: jest.fn().mockResolvedValue([application])
        }))
      }))
    }))
  };
  const communicationModel = {
    find: jest.fn(() => ({
      populate: jest.fn(() => ({
        sort: jest.fn(() => ({
          limit: jest.fn(() => ({
            lean: jest.fn().mockResolvedValue([communication])
          }))
        }))
      }))
    }))
  };

  return {
    models: {
      Student: studentModel,
      Application: applicationModel,
      Communication: communicationModel
    },
    req: {
      user: { _id: 'agent_1', role: Role.Agent },
      db: {
        model: jest.fn((name) => {
          const model = {
            Student: studentModel,
            Application: applicationModel,
            Communication: communicationModel
          }[name];

          if (!model) {
            throw new Error(`Unexpected model: ${name}`);
          }

          return model;
        })
      }
    }
  };
};

beforeEach(() => {
  jest.clearAllMocks();
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

  it('sends a message and persists an assistant trace record', async () => {
    const insertedRows = [
      { id: 'msg_user', role: 'user', content: 'Find my students' },
      {
        id: 'msg_assistant',
        role: 'assistant',
        content: 'mocked AI Assist answer'
      },
      {
        id: 'trace_1',
        toolName: 'search_accessible_students',
        status: 'success'
      }
    ];
    let insertIndex = 0;
    const updateWhere = jest.fn().mockResolvedValue([]);
    const updateSet = jest.fn(() => ({ where: updateWhere }));
    const insertedValues = [];
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
      select: jest.fn(() => ({
        from: jest.fn(() => ({
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
        }))
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
    expect(res.send.mock.calls[0][0].data.answer).toContain(
      'mocked AI Assist answer'
    );
    expect(res.send.mock.calls[0][0].data.trace[0]).toMatchObject({
      toolName: 'search_accessible_students',
      status: 'success'
    });
    expect(openAIClient.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.stringContaining('"toolContext"')
      })
    );
    expect(openAIClient.responses.create.mock.calls[0][0].input).toContain(
      'abby Student'
    );
    expect(openAIClient.responses.create.mock.calls[0][0].input).toContain(
      '學生艾比'
    );
    expect(insertedValues[2].arguments).toEqual({
      query: 'Find Abby',
      limit: 10
    });
    expect(postgres.update).toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith({ updatedAt: expect.any(Date) });
    expect(updateWhere).toHaveBeenCalled();
    expect(find).toHaveBeenCalled();
  });
});

describe('AI Assist tool routing', () => {
  it('routes a specific student application question through application tools', async () => {
    const { postgres, insertedValues } = createAiAssistPostgres();
    const { models, req } = createAiAssistReq();

    await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: '學生艾比目前申請狀況如何？',
      req
    });

    expect(models.Student.find).toHaveBeenCalled();
    expect(models.Student.findById).toHaveBeenCalledWith('student_abby');
    expect(models.Application.find).toHaveBeenCalledWith({
      studentId: 'student_abby'
    });
    expect(
      insertedValues
        .filter((value) => value.toolName)
        .map((value) => value.toolName)
    ).toEqual([
      'search_accessible_students',
      'get_student_summary',
      'get_student_applications'
    ]);
    expect(openAIClient.responses.create.mock.calls[0][0].input).toContain(
      'get_student_applications'
    );
    expect(openAIClient.responses.create.mock.calls[0][0].input).toContain(
      'TU Berlin'
    );
  });

  it('routes a specific student message question through communication tools', async () => {
    const { postgres, insertedValues } = createAiAssistPostgres();
    const { models, req } = createAiAssistReq();

    await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: '幫我看學生艾比最近 message 對話重點',
      req
    });

    expect(models.Student.findById).toHaveBeenCalledWith('student_abby');
    expect(models.Communication.find).toHaveBeenCalledWith({
      student_id: 'student_abby'
    });
    expect(
      insertedValues
        .filter((value) => value.toolName)
        .map((value) => value.toolName)
    ).toEqual([
      'search_accessible_students',
      'get_student_summary',
      'get_latest_communications'
    ]);
    expect(openAIClient.responses.create.mock.calls[0][0].input).toContain(
      'get_latest_communications'
    );
    expect(openAIClient.responses.create.mock.calls[0][0].input).toContain(
      'missing transcript'
    );
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
    const lean = jest.fn().mockResolvedValue([
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
    const limit = jest.fn(() => ({ lean }));
    const select = jest.fn(() => ({ limit }));
    const find = jest.fn(() => ({ select }));
    const req = {
      user: { role: Role.Agent, _id: 'agent_1' },
      db: {
        model: jest.fn(() => ({ find }))
      }
    };

    const result = await runTool(req, 'search_accessible_students', {
      query: 'Ada',
      limit: 5
    });

    expect(find).toHaveBeenCalledWith({
      $or: [{ archiv: { $exists: false } }, { archiv: false }],
      agents: 'agent_1',
      $text: { $search: 'Ada' }
    });
    expect(limit).toHaveBeenCalledWith(5);
    expect(result.data[0]).toMatchObject({
      id: 'student_1',
      name: 'Ada Lovelace',
      email: 'ada@example.com'
    });
  });

  it('get_student_applications returns application and program facts', async () => {
    const lean = jest.fn().mockResolvedValue([
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
    const populate = jest.fn(() => ({ lean }));
    const select = jest.fn(() => ({ populate }));
    const find = jest.fn(() => ({ select }));
    const req = {
      user: { role: Role.Admin, _id: 'admin_1' },
      db: {
        model: jest.fn(() => ({ find }))
      }
    };

    const result = await runTool(req, 'get_student_applications', {
      studentId: 'student_1'
    });

    expect(find).toHaveBeenCalledWith({ studentId: 'student_1' });
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
});
