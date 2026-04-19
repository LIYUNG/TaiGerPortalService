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
  archiveConversation,
  getConversation,
  listConversations,
  listRecentStudents,
  listMyStudents,
  sendMessage,
  sendFirstMessage,
  updateConversation,
  searchStudents
} = require('../../controllers/ai_assist');
const {
  aiAssistConversations,
  aiAssistMessages,
  aiAssistToolCalls
} = require('../../drizzle/schema/schema');
const {
  getAccessibleStudentFilter
} = require('../../services/ai-assist/studentAccess');
const { runAiAssist } = require('../../services/ai-assist/orchestrator');
const aiAssistTools = require('../../services/ai-assist/tools');
const { runTool } = aiAssistTools;

const createResponse = () => {
  const res = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis()
  };
  return res;
};

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
          const row = insertedRows[insertIndex] || insertedRows[insertedRows.length - 1];
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

const createAiAssistPostgresWithContext = ({
  conversation = {
    id: 'conv_1',
    studentId: 'student_abby',
    studentDisplayName: 'Abby Student'
  },
  messages = [],
  toolCalls = []
}) => {
  const base = createAiAssistPostgres();
  let selectCall = 0;
  const select = jest.fn(() => ({
    from: jest.fn(() => {
      const callIndex = selectCall++;
      const rows =
        callIndex === 0 ? [conversation] : callIndex === 1 ? messages : toolCalls;

      return {
        where: jest.fn(() => ({
          limit: jest.fn().mockResolvedValue(rows),
          orderBy: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue(rows)
          }))
        }))
      };
    })
  }));

  return {
    ...base,
    postgres: {
      ...base.postgres,
      select
    }
  };
};

const createStudentQuickStartReq = ({
  students = [],
  user = { _id: 'agent_1', role: Role.Agent }
} = {}) => {
  const lean = jest.fn().mockResolvedValue(students);
  const limit = jest.fn(() => ({ lean }));
  const select = jest.fn(() => ({ limit }));
  const find = jest.fn(() => ({ select }));

  return {
    req: {
      user,
      query: {},
      db: {
        model: jest.fn(() => ({ find }))
      }
    },
    models: {
      Student: { find, select, limit, lean }
    }
  };
};

const createStudentAccessReq = ({
  students = [],
  user = { _id: 'agent_1', role: Role.Agent }
} = {}) => {
  const studentModel = {
    find: jest.fn((filter = {}) => {
      const requestedIds = filter._id
        ? Array.isArray(filter._id.$in)
          ? filter._id.$in
          : [filter._id]
        : null;
      const rows = requestedIds
        ? students.filter((student) => requestedIds.includes(student._id))
        : students;

      return {
        select: jest.fn(() => ({
          limit: jest.fn(() => ({
            lean: jest.fn().mockResolvedValue(rows)
          }))
        }))
      };
    })
  };

  return {
    req: {
      user,
      query: {},
      db: {
        model: jest.fn((name) => {
          if (name !== 'Student') {
            throw new Error(`Unexpected model: ${name}`);
          }

          return studentModel;
        })
      }
    },
    models: {
      Student: studentModel
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

  it('rejects inaccessible bound student metadata when creating a conversation', async () => {
    const postgres = {
      insert: jest.fn()
    };
    getPostgresDb.mockReturnValue(postgres);
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

    await expect(createConversation(req, res)).rejects.toThrow();

    expect(postgres.insert).not.toHaveBeenCalled();
  });

  it('creates a first-message conversation with bound student context', async () => {
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
      { id: 'msg_assistant', role: 'assistant', content: 'mocked AI Assist answer' }
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
    expect(postgres.insert).toHaveBeenCalledTimes(5);
    expect(res.send.mock.calls[0][0].data.conversation).toMatchObject({
      id: 'conv_1',
      studentId: 'student_abby',
      studentDisplayName: 'Abby Student',
      status: 'active'
    });
    expect(res.send.mock.calls[0][0].data.answer).toBe('mocked AI Assist answer');
    expect(updateSet).toHaveBeenCalledWith({ updatedAt: expect.any(Date) });
    expect(runAiAssistSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        assistContext: {
          mentionedStudent: { id: 'student_abby', displayName: 'abby Student' },
          requestedSkill: 'summarize_student',
          unknownSkillText: null
        }
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
        assistContext: {
          mentionedStudent: { id: 'student_abby', displayName: 'Abby Student' },
          requestedSkill: 'identify_risk',
          unknownSkillText: null
        }
      })
    );
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

  it('rejects mismatched bound student display names on first-message conversations', async () => {
    const postgres = {
      insert: jest.fn(),
      transaction: jest.fn()
    };
    getPostgresDb.mockReturnValue(postgres);
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

    await expect(sendFirstMessage(req, res)).rejects.toThrow();

    expect(postgres.insert).not.toHaveBeenCalled();
    expect(postgres.transaction).not.toHaveBeenCalled();
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

    expect(insertedValues[0]).toMatchObject({
      studentId: 'student_abby',
      studentDisplayName: 'abby Student'
    });
    expect(insertedValues[1]).toMatchObject({
      studentId: 'student_abby',
      studentDisplayName: 'abby Student'
    });
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

    await expect(getConversation(archivedGetReq, createResponse())).rejects.toThrow(
      'AI Assist conversation not found'
    );
    await expect(
      updateConversation(archivedUpdateReq, createResponse())
    ).rejects.toThrow('AI Assist conversation not found');
    await expect(sendMessage(archivedSendReq, createResponse())).rejects.toThrow(
      'AI Assist conversation not found'
    );

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
    const studentFind = req.db.model.mock.results[0].value.find;
    expect(studentFind).toHaveBeenCalledWith({
      $or: [{ archiv: { $exists: false } }, { archiv: false }],
      agents: 'agent_1',
      _id: { $in: ['student_abby', 'student_bob'] }
    });
  });

  it('keeps fetching recent conversations until 25 unique students are collected', async () => {
    getPermission.mockResolvedValue({});
    const duplicateRows = Array.from({ length: 35 }, (_, index) => ({
      id: `conv_dup_${index}`,
      studentId: index % 2 === 0 ? 'student_dup_1' : 'student_dup_2',
      studentDisplayName: index % 2 === 0 ? 'Duplicate One' : 'Duplicate Two',
      updatedAt: new Date(`2026-04-12T10:${String(index).padStart(2, '0')}:00.000Z`),
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
                  limit: jest.fn().mockResolvedValue(
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
        { _id: 'student_dup_1', firstname: 'Duplicate', lastname: 'One', role: Role.Student },
        { _id: 'student_dup_2', firstname: 'Duplicate', lastname: 'Two', role: Role.Student },
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
      expect.arrayContaining([
        expect.objectContaining({ id: 'student_23' })
      ])
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
    const studentFind = req.db.model.mock.results[0].value.find;
    expect(studentFind).toHaveBeenCalledWith({
      $or: [{ archiv: { $exists: false } }, { archiv: false }],
      agents: 'agent_1'
    });
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
    const studentFind = req.db.model.mock.results[0].value.find;
    expect(studentFind).toHaveBeenCalledWith({
      $or: [{ archiv: { $exists: false } }, { archiv: false }],
      agents: 'agent_1',
      $text: { $search: 'Abby' }
    });
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
          returning: jest.fn().mockResolvedValue([
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
          find: jest.fn()
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
            name: 'search_accessible_students',
            arguments: JSON.stringify({ query: 'Find Abby', limit: 10 })
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
        toolName: 'search_accessible_students',
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
          const callIndex = selectIndex++;
          if (table === aiAssistConversations) {
            if (callIndex === 0) {
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
                limit: jest.fn().mockResolvedValue([
                  {
                    id: 'conv_1',
                    ownerUserId: 'agent_1',
                    ownerRole: Role.Agent,
                    studentId: 'student_abby',
                    studentDisplayName: 'Abby Student',
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
      toolName: 'search_accessible_students',
      status: 'success'
    });
    expect(openAIClient.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'search_accessible_students' })
        ])
      })
    );
    expect(insertedValues[2].arguments).toEqual({
      query: 'Find Abby',
      limit: 10
    });
    expect(postgres.update).toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith({ updatedAt: expect.any(Date) });
    expect(updateWhere).toHaveBeenCalled();
    expect(updateReturning).toHaveBeenCalled();
    expect(find).toHaveBeenCalled();
  });

  it('stores skillTrace on the assistant message record', async () => {
    const { postgres, insertedValues } = createAiAssistPostgresWithContext({});

    await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: '@Abby Student #identify_risk focus on blockers',
      assistContext: {
        mentionedStudent: { id: 'student_abby', displayName: 'Abby Student' },
        requestedSkill: 'identify_risk',
        unknownSkillText: null
      },
      req: createAiAssistReq().req
    });

    const assistantInsert = insertedValues.find(
      (value) => value.role === 'assistant'
    );

    expect(assistantInsert).toMatchObject({
      role: 'assistant',
      skillTrace: expect.objectContaining({
        requestedSkill: 'identify_risk',
        resolvedSkill: 'identify_risk',
        mode: 'skill',
        status: 'completed',
        steps: expect.arrayContaining([
          expect.objectContaining({ toolName: 'get_student_applications' }),
          expect.objectContaining({ toolName: 'get_latest_communications' })
        ])
      })
    });
  });
});

describe('AI Assist Responses function tool loop', () => {
  it('runs identify_risk in skill mode with fixed tools', async () => {
    const runToolSpy = jest
      .spyOn(aiAssistTools, 'runTool')
      .mockResolvedValueOnce({
        data: [
          {
            id: 'application_1',
            admission: 'pending',
            program: { school: 'TU Berlin', name: 'Computer Science' }
          }
        ]
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 'message_1',
            message: 'Please upload the missing transcript.'
          }
        ]
      });
    openAIClient.responses.create.mockResolvedValueOnce({
      id: 'resp_skill',
      output_text: 'Risk summary answer',
      output: []
    });
    const { postgres, insertedValues } = createAiAssistPostgresWithContext({});

    await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: '@Abby Student #identify_risk focus on blockers',
      assistContext: {
        mentionedStudent: { id: 'student_abby', displayName: 'Abby Student' },
        requestedSkill: 'identify_risk',
        unknownSkillText: null
      },
      req: {
        user: { _id: 'agent_1', role: Role.Agent },
        db: { model: jest.fn() }
      }
    });

    expect(runToolSpy).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'get_student_applications',
      { studentId: 'student_abby' }
    );
    expect(runToolSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'get_latest_communications',
      { studentId: 'student_abby', limit: 10 }
    );
    expect(openAIClient.responses.create).toHaveBeenCalledTimes(1);
    expect(openAIClient.responses.create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        tools: expect.anything()
      })
    );
    expect(
      insertedValues
        .filter((value) => value.toolName)
        .map((value) => value.toolName)
    ).toEqual(['get_student_applications', 'get_latest_communications']);
    expect(
      insertedValues.find((value) => value.role === 'assistant')?.skillTrace
    ).toMatchObject({
      requestedSkill: 'identify_risk',
      resolvedSkill: 'identify_risk',
      mode: 'skill',
      student: {
        id: 'student_abby',
        displayName: 'Abby Student'
      },
      status: 'completed',
      fallbackReason: null
    });
  });

  it('falls back to general mode for unknown skill text', async () => {
    const runToolSpy = jest.spyOn(aiAssistTools, 'runTool');
    openAIClient.responses.create.mockResolvedValueOnce({
      id: 'resp_general',
      output_text: 'General fallback answer',
      output: []
    });
    const { postgres, insertedValues } = createAiAssistPostgresWithContext({});
    const { req } = createAiAssistReq();

    await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: '@Abby Student #draft_recommendation focus on next steps',
      assistContext: {
        mentionedStudent: { id: 'student_abby', displayName: 'Abby Student' },
        requestedSkill: null,
        unknownSkillText: 'draft_recommendation'
      },
      req
    });

    expect(runToolSpy).not.toHaveBeenCalled();
    expect(openAIClient.responses.create).toHaveBeenCalledTimes(1);
    expect(openAIClient.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'get_student_applications' })
        ])
      })
    );
    expect(
      insertedValues.find((value) => value.role === 'assistant')?.skillTrace
    ).toMatchObject({
      requestedSkill: null,
      resolvedSkill: null,
      mode: 'general',
      fallbackReason: expect.stringContaining('draft_recommendation')
    });
  });

  it('passes recent conversation messages and tool traces into the model input', async () => {
    openAIClient.responses.create.mockResolvedValueOnce({
      id: 'resp_final',
      output_text: 'Conversation-aware answer',
      output: []
    });
    const { postgres } = createAiAssistPostgresWithContext({
      conversation: {
        id: 'conv_1',
        studentId: 'student_abby',
        studentDisplayName: 'Abby Student'
      },
      messages: [
        {
          role: 'assistant',
          content:
            '1. Testing-AJ Student\n2. abby Student (student_abby) - abbystudent@gmail.com'
        },
        {
          role: 'user',
          content: 'Summarize a student'
        }
      ],
      toolCalls: [
        {
          toolName: 'search_accessible_students',
          arguments: { query: 'Summarize a student', limit: 10 },
          result: {
            data: [
              {
                id: 'student_testing',
                name: 'Testing-AJ Student',
                chineseName: 'Testing Student'
              },
              {
                id: 'student_abby',
                name: 'abby Student',
                chineseName: '學生艾比',
                email: 'abbystudent@gmail.com'
              }
            ]
          },
          status: 'success'
        }
      ]
    });
    const { req } = createAiAssistReq();

    await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: '2',
      req
    });

    const firstInput = openAIClient.responses.create.mock.calls[0][0].input;
    expect(firstInput[0].content).toContain('"conversationContext"');
    expect(firstInput[0].content).toContain('"currentUserMessage": "2"');
    expect(firstInput[0].content).toContain('"boundStudentId": "student_abby"');
    expect(firstInput[0].content).toContain(
      '"boundStudentDisplayName": "Abby Student"'
    );
    expect(firstInput[0].content).toContain('student_abby');
    expect(firstInput[0].content).toContain('abbystudent@gmail.com');
  });

  it('instructs the model to mirror the current user language without forcing Traditional Chinese', async () => {
    openAIClient.responses.create.mockResolvedValueOnce({
      id: 'resp_final',
      output_text: '繁體中文回答',
      output: []
    });
    const { postgres } = createAiAssistPostgresWithContext({});
    const { req } = createAiAssistReq();

    await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: '幫我看學生艾比最近 message 對話重點',
      req
    });

    const modelInstructions =
      openAIClient.responses.create.mock.calls[0][0].instructions;
    expect(modelInstructions).toContain(
      "Match the user's current language and writing system exactly"
    );
    expect(modelInstructions).not.toContain('Traditional Chinese');
    expect(modelInstructions).not.toContain('Simplified Chinese');
  });

  it('executes model-selected application tools and returns tool outputs to the model', async () => {
    openAIClient.responses.create
      .mockResolvedValueOnce({
        id: 'resp_search',
        output_text: '',
        output: [
          {
            type: 'function_call',
            call_id: 'call_search',
            name: 'search_accessible_students',
            arguments: JSON.stringify({ query: 'Abby', limit: 5 })
          }
        ]
      })
      .mockResolvedValueOnce({
        id: 'resp_applications',
        output_text: '',
        output: [
          {
            type: 'function_call',
            call_id: 'call_applications',
            name: 'get_student_applications',
            arguments: JSON.stringify({ studentId: 'student_abby' })
          }
        ]
      })
      .mockResolvedValueOnce({
        id: 'resp_final',
        output_text: 'Application status answer',
        output: []
      });
    const { postgres, insertedValues } = createAiAssistPostgres();
    const { models, req } = createAiAssistReq();

    await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: 'What is Abby application status?',
      req
    });

    expect(models.Student.find).toHaveBeenCalled();
    expect(models.Application.find).toHaveBeenCalledWith({
      studentId: 'student_abby'
    });
    expect(
      insertedValues
        .filter((value) => value.toolName)
        .map((value) => value.toolName)
    ).toEqual(['search_accessible_students', 'get_student_applications']);
    expect(openAIClient.responses.create.mock.calls[0][0].tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'get_student_applications' })
      ])
    );
    expect(openAIClient.responses.create.mock.calls[1][0].input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'call_search',
          output: expect.stringContaining('abby Student')
        })
      ])
    );
    expect(openAIClient.responses.create.mock.calls[2][0].input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'call_applications',
          output: expect.stringContaining('TU Berlin')
        })
      ])
    );
  });

  it('executes model-selected communication tools and returns tool outputs to the model', async () => {
    openAIClient.responses.create
      .mockResolvedValueOnce({
        id: 'resp_messages',
        output_text: '',
        output: [
          {
            type: 'function_call',
            call_id: 'call_messages',
            name: 'get_latest_communications',
            arguments: JSON.stringify({ studentId: 'student_abby', limit: 10 })
          }
        ]
      })
      .mockResolvedValueOnce({
        id: 'resp_final',
        output_text: 'Message summary answer',
        output: []
      });
    const { postgres, insertedValues } = createAiAssistPostgres();
    const { models, req } = createAiAssistReq();

    await runAiAssist(postgres, {
      conversationId: 'conv_1',
      message: 'Summarize Abby latest messages',
      req
    });

    expect(models.Communication.find).toHaveBeenCalledWith({
      student_id: 'student_abby'
    });
    expect(
      insertedValues
        .filter((value) => value.toolName)
        .map((value) => value.toolName)
    ).toEqual(['get_latest_communications']);
    expect(openAIClient.responses.create.mock.calls[1][0].input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'call_messages',
          output: expect.stringContaining('missing transcript')
        })
      ])
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
    const studentLimit = jest.fn(() => ({
      lean: jest.fn().mockResolvedValue([student])
    }));
    const studentSelect = jest.fn(() => ({ limit: studentLimit }));
    const studentFind = jest.fn(() => ({ select: studentSelect }));
    const populate = jest.fn(() => ({ lean }));
    const select = jest.fn(() => ({ populate }));
    const find = jest.fn(() => ({ select }));
    const req = {
      user: { role: Role.Admin, _id: 'admin_1' },
      db: {
        model: jest.fn((name) => {
          if (name === 'Student') {
            return { find: studentFind };
          }

          return { find };
        })
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
