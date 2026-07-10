// HTTP-stack integration test for the document-thread routes with the DAO layer
// MOCKED (no database, in-memory or otherwise):
//   supertest -> real router (routes/documents_modification) ->
//   real middleware -> real controllers/documents_modification ->
//   real services (DocumentThread/Student/User/Application/SurveyInput/Audit) ->
//   MOCKED DAOs.
//
// Only the auth/tenant/permission/upload middleware and the S3 + email side
// channels are stubbed as before; in addition every DAO the exercised handlers
// reach is mocked, so each test asserts the controller/service forwards the
// right arguments to the DAO and shapes the HTTP response from the DAO's
// (mocked) return. The real DB query/aggregation construction is covered by the
// DAO unit tests. Fully deterministic — no engine, no seed.

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
const { ObjectId } = require('mongoose').Types;

import { app } from '../../app';
import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';
import { admin, agent, student } from '../mock/user';

const requestWithSupertest = request(app);

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

// ---- Standard middleware mocks ----
// The plain-passthrough ones come from one shared helper (see
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
jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () =>
  require('../helpers/middlewareMocks').innerTaigerMultitenantFilterMock()
);
// This file also stubs `permission_canModifyDocs_filter`, which
// permissionFilterMock() doesn't cover by default.
jest.mock('../../middlewares/permission-filter', () => {
  const mw = require('../helpers/middlewareMocks');
  return mw.permissionFilterMock({
    permission_canModifyDocs_filter: mw.passthroughFn()
  });
});
jest.mock('../../middlewares/multitenant-filter', () =>
  require('../helpers/middlewareMocks').multitenantFilterMock()
);
jest.mock('../../middlewares/limit_archiv_user', () =>
  require('../helpers/middlewareMocks').limitArchivUserMock()
);

// ---- Domain-specific middleware mocks (route-specific bodies; stay inline) ----

jest.mock('../../middlewares/file-upload', () => {
  const passthrough = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    req.files = [];
    next();
  };
  const passthroughSingle = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    req.file = undefined;
    next();
  };
  return {
    // Do NOT use jest.requireActual here — loading the real file-upload.js calls
    // multerS3({ s3: s3Client }) at module evaluation time which crashes in tests.
    imageUpload: passthroughSingle,
    admissionUpload: passthroughSingle,
    documentationDocsUpload: passthroughSingle,
    VPDfileUpload: passthrough,
    ProfilefileUpload: passthrough,
    TemplatefileUpload: passthroughSingle,
    MessagesThreadUpload: passthrough,
    MessagesTicketUpload: passthrough,
    MessagesChatUpload: passthrough,
    MessagesImageThreadUpload: passthroughSingle,
    upload: passthroughSingle
  };
});

jest.mock('../../middlewares/documentThreadMultitenantFilter', () => {
  const passthrough = async (req: Request, res: Response, next: NextFunction) =>
    next();
  return {
    docThreadMultitenant_filter: jest.fn().mockImplementation(passthrough),
    surveyMultitenantFilter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/AssignOutsourcerFilter', () => {
  const passthrough = async (req: Request, res: Response, next: NextFunction) =>
    next();
  return { AssignOutsourcerFilter: jest.fn().mockImplementation(passthrough) };
});

jest.mock('../../middlewares/editorIdsBodyFilter', () => {
  const passthrough = async (req: Request, res: Response, next: NextFunction) =>
    next();
  return { editorIdsBodyFilter: jest.fn().mockImplementation(passthrough) };
});

jest.mock('../../middlewares/docs_thread_operation_validation', () => {
  const passthrough = async (req: Request, res: Response, next: NextFunction) =>
    next();
  return {
    doc_thread_ops_validator: jest.fn().mockImplementation(passthrough)
  };
});

// ---- Service / utility side-effect mocks (email + S3 only) ----

jest.mock('../../services/email', () => ({
  sendNewGeneraldocMessageInThreadEmail: jest.fn(),
  sendNewApplicationMessageInThreadEmail: jest.fn(),
  assignEssayTaskToEditorEmail: jest.fn(),
  sendSetAsFinalGeneralFileForAgentEmail: jest.fn(),
  sendSetAsFinalGeneralFileForStudentEmail: jest.fn(),
  sendSetAsFinalProgramSpecificFileForStudentEmail: jest.fn(),
  sendSetAsFinalProgramSpecificFileForAgentEmail: jest.fn(),
  assignDocumentTaskToEditorEmail: jest.fn(),
  assignDocumentTaskToStudentEmail: jest.fn(),
  sendAssignEditorReminderEmail: jest.fn(),
  sendAssignEssayWriterReminderEmail: jest.fn(),
  sendAssignTrainerReminderEmail: jest.fn(),
  sendNewInterviewMessageInThreadEmail: jest.fn(),
  informOnSurveyUpdate: jest.fn(),
  informEssayWriterNewEssayEmail: jest.fn(),
  informStudentTheirEssayWriterEmail: jest.fn(),
  informAgentEssayAssignedEmail: jest.fn()
}));

jest.mock('../../aws/s3', () => ({
  getS3Object: jest.fn().mockResolvedValue({ Body: { pipe: jest.fn() } }),
  putS3Object: jest.fn().mockResolvedValue({}),
  deleteS3Object: jest.fn().mockResolvedValue({}),
  deleteS3Objects: jest.fn().mockResolvedValue({}),
  listS3ObjectsV2: jest.fn().mockResolvedValue({ Contents: [] })
}));

jest.mock('../../utils/informEditor', () => ({
  informOnSurveyUpdate: jest.fn().mockResolvedValue({})
}));

jest.mock('../../utils/log/auditLog', () => ({
  auditLog: (req: Request, res: Response, next: NextFunction) => next()
}));

// ---- The data boundary: mock every DAO the exercised handlers reach ----

jest.mock('../../dao/documentthread.dao');
jest.mock('../../dao/student.dao');
jest.mock('../../dao/user.dao');
jest.mock('../../dao/surveyInput.dao');
jest.mock('../../dao/application.dao');
jest.mock('../../dao/audit.dao');

import DocumentthreadDAOModule from '../../dao/documentthread.dao';
import StudentDAOModule from '../../dao/student.dao';
import UserDAOModule from '../../dao/user.dao';
import SurveyInputDAOModule from '../../dao/surveyInput.dao';
import ApplicationDAOModule from '../../dao/application.dao';
import AuditDAOModule from '../../dao/audit.dao';

// The DAOs are auto-mocked above; re-type each as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const DocumentthreadDAO = DocumentthreadDAOModule as unknown as MockedDAO;
const StudentDAO = StudentDAOModule as unknown as MockedDAO;
const UserDAO = UserDAOModule as unknown as MockedDAO;
const SurveyInputDAO = SurveyInputDAOModule as unknown as MockedDAO;
const ApplicationDAO = ApplicationDAOModule as unknown as MockedDAO;
const AuditDAO = AuditDAOModule as unknown as MockedDAO;

// ---- IDs used across tests ----
const threadId = new ObjectId().toHexString();
const surveyInputId = new ObjectId().toHexString();
const messageId = new ObjectId().toHexString();

beforeEach(() => {
  jest.clearAllMocks();
  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = admin;
      next();
    }
  );
  // Sensible global defaults; individual tests override the relevant ones.
  StudentDAO.fetchSimpleStudents.mockResolvedValue([{ _id: student._id }]);
});

describe('GET /api/document-threads/overview/all', () => {
  it('returns the active threads (filtered) as a success array', async () => {
    // getAllStudentsThreads: fetchSimpleStudents -> findAllStudentsThreadsPopulated,
    // then filters to decided/non-Interview threads.
    DocumentthreadDAO.findAllStudentsThreadsPopulated.mockResolvedValue([
      { _id: threadId, file_type: 'ML', application_id: null },
      { _id: new ObjectId(), file_type: 'Interview', application_id: null }
    ]);

    const resp = await requestWithSupertest
      .get('/api/document-threads/overview/all')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    // Interview threads are filtered out by the service.
    expect(resp.body.data).toHaveLength(1);
    expect(resp.body.data[0]._id).toBe(threadId);
    expect(StudentDAO.fetchSimpleStudents).toHaveBeenCalled();
    expect(
      DocumentthreadDAO.findAllStudentsThreadsPopulated
    ).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/document-threads/overview/my-student-metrics', () => {
  it('returns a students array shaped from getStudentsWithApplications', async () => {
    StudentDAO.getStudentsWithApplications.mockResolvedValue([
      {
        _id: student._id,
        applications: [],
        generaldocs_threads: []
      }
    ]);

    const resp = await requestWithSupertest
      .get('/api/document-threads/overview/my-student-metrics')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data.students)).toBe(true);
    expect(resp.body.data.students).toHaveLength(1);
    expect(StudentDAO.getStudentsWithApplications).toHaveBeenCalledWith({
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });
  });
});

describe('GET /api/document-threads/overview/taiger-user/:userId', () => {
  it('returns { threads, user } for the requested TaiGer user', async () => {
    DocumentthreadDAO.findThreadsForTaiGerUserPopulated.mockResolvedValue([
      {
        _id: threadId,
        file_type: 'ML',
        application_id: null,
        student_id: {
          agents: [{ _id: agent._id }],
          editors: [],
          archiv: false
        },
        outsourced_user_id: []
      }
    ]);
    UserDAO.getUserById.mockResolvedValue({
      _id: agent._id,
      firstname: agent.firstname,
      lastname: agent.lastname
    });

    const resp = await requestWithSupertest
      .get(`/api/document-threads/overview/taiger-user/${agent._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data.threads)).toBe(true);
    expect(resp.body.data.threads).toHaveLength(1);
    expect(resp.body.data.user._id.toString()).toBe(agent._id.toString());
    expect(UserDAO.getUserById).toHaveBeenCalledWith(agent._id.toString());
  });
});

describe('GET /api/document-threads/student-threads/:studentId', () => {
  it('returns the student thread payload from findThreadsByStudentIdPopulated', async () => {
    asMock(protect).mockImplementation(
      async (req: Request, res: Response, next: NextFunction) => {
        req.user = agent;
        next();
      }
    );
    DocumentthreadDAO.findThreadsByStudentIdPopulated.mockResolvedValue([
      { _id: threadId, file_type: 'ML', application_id: null }
    ]);

    const resp = await requestWithSupertest
      .get(`/api/document-threads/student-threads/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data).toHaveProperty('threads');
    expect(resp.body.data.threads).toHaveLength(1);
    expect(
      DocumentthreadDAO.findThreadsByStudentIdPopulated
    ).toHaveBeenCalledWith(student._id.toString());
  });
});

describe('GET /api/document-threads/:messagesThreadId/survey-inputs', () => {
  it('returns the thread merged with its resolved survey inputs', async () => {
    asMock(protect).mockImplementation(
      async (req: Request, res: Response, next: NextFunction) => {
        req.user = agent;
        next();
      }
    );
    DocumentthreadDAO.findThreadByIdFullyPopulated.mockResolvedValue({
      _id: threadId,
      student_id: { _id: student._id },
      program_id: null,
      file_type: 'ML'
    });
    SurveyInputDAO.findSurveyInputs.mockResolvedValue([]);

    const resp = await requestWithSupertest
      .get(`/api/document-threads/${threadId}/survey-inputs`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id.toString()).toBe(threadId);
    expect(resp.body.data).toHaveProperty('surveyInputs');
    expect(DocumentthreadDAO.findThreadByIdFullyPopulated).toHaveBeenCalledWith(
      threadId
    );
    expect(SurveyInputDAO.findSurveyInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: student._id.toString(),
        fileType: 'ML'
      })
    );
  });

  it('404s when the thread does not exist', async () => {
    asMock(protect).mockImplementation(
      async (req: Request, res: Response, next: NextFunction) => {
        req.user = agent;
        next();
      }
    );
    DocumentthreadDAO.findThreadByIdFullyPopulated.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .get(`/api/document-threads/${threadId}/survey-inputs`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(404);
    expect(SurveyInputDAO.findSurveyInputs).not.toHaveBeenCalled();
  });
});

describe('PUT /api/document-threads/survey-input/:surveyInputId', () => {
  it('updates the survey input via the DAO and returns it', async () => {
    SurveyInputDAO.updateSurveyInputById.mockResolvedValue({
      _id: surveyInputId,
      surveyStatus: 'provided',
      studentId: student._id,
      programId: null,
      fileType: 'ML'
    });

    const resp = await requestWithSupertest
      .put(`/api/document-threads/survey-input/${surveyInputId}`)
      .set('tenantId', TENANT_ID)
      .send({ input: { surveyStatus: 'provided' }, informEditor: false });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.surveyStatus).toBe('provided');
    expect(SurveyInputDAO.updateSurveyInputById).toHaveBeenCalledWith(
      surveyInputId,
      expect.objectContaining({ surveyStatus: 'provided' })
    );
  });
});

describe('POST /api/document-threads/survey-input', () => {
  it('creates a new survey input via the DAO and returns it', async () => {
    const newId = new ObjectId().toHexString();
    SurveyInputDAO.createSurveyInput.mockResolvedValue({
      _id: newId,
      studentId: student._id,
      programId: null,
      fileType: 'RL',
      surveyContent: {},
      surveyStatus: 'empty'
    });

    const resp = await requestWithSupertest
      .post('/api/document-threads/survey-input')
      .set('tenantId', TENANT_ID)
      .send({
        input: {
          studentId: student._id,
          programId: null,
          fileType: 'RL',
          surveyContent: {},
          surveyStatus: 'empty'
        },
        informEditor: false
      });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.fileType).toBe('RL');
    expect(resp.body.data._id).toBeDefined();
    expect(SurveyInputDAO.createSurveyInput).toHaveBeenCalledWith(
      expect.objectContaining({ fileType: 'RL' })
    );
  });
});

describe('PUT /api/document-threads/:messagesThreadId/favorite', () => {
  it('toggles the favourite flag for the user via the DAO', async () => {
    asMock(protect).mockImplementation(
      async (req: Request, res: Response, next: NextFunction) => {
        req.user = agent;
        next();
      }
    );
    // putThreadFavorite: getThreadById (existence + current flags) -> updateThreadById.
    DocumentthreadDAO.findThreadByIdFullyPopulated.mockResolvedValue({
      _id: threadId,
      flag_by_user_id: []
    });
    DocumentthreadDAO.updateThreadByIdReturnNew.mockResolvedValue({
      _id: threadId,
      flag_by_user_id: [agent._id]
    });

    const resp = await requestWithSupertest
      .put(`/api/document-threads/${threadId}/favorite`)
      .set('tenantId', TENANT_ID)
      .send({});

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    // Not flagged before -> add to favourites -> new state is true.
    expect(resp.body.data.isFlagged).toBe(true);
    expect(DocumentthreadDAO.updateThreadByIdReturnNew).toHaveBeenCalledWith(
      threadId,
      { $addToSet: { flag_by_user_id: agent._id } }
    );
  });

  it('404s when the thread does not exist', async () => {
    asMock(protect).mockImplementation(
      async (req: Request, res: Response, next: NextFunction) => {
        req.user = agent;
        next();
      }
    );
    DocumentthreadDAO.findThreadByIdFullyPopulated.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .put(`/api/document-threads/${threadId}/favorite`)
      .set('tenantId', TENANT_ID)
      .send({});

    expect(resp.status).toBe(404);
    expect(DocumentthreadDAO.updateThreadByIdReturnNew).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/document-threads/:messagesThreadId/:studentId', () => {
  it('deletes the (general) thread and reports success', async () => {
    // handleDeleteGeneralThread: getThreadDocById + getStudentDocById guards,
    // then deleteGeneralThread -> emptyS3Directory (S3) + deleteThreadById +
    // updateStudentByIdRaw.
    DocumentthreadDAO.getThreadDocById.mockResolvedValue({
      _id: threadId,
      student_id: student._id
    });
    StudentDAO.getStudentDocById.mockResolvedValue({ _id: student._id });
    DocumentthreadDAO.deleteThreadById.mockResolvedValue({ _id: threadId });
    StudentDAO.updateStudentByIdRaw.mockResolvedValue({});

    const resp = await requestWithSupertest
      .delete(`/api/document-threads/${threadId}/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(DocumentthreadDAO.deleteThreadById).toHaveBeenCalledWith(threadId);
    expect(StudentDAO.updateStudentByIdRaw).toHaveBeenCalledWith(
      student._id.toString(),
      {
        $pull: { generaldocs_threads: { doc_thread_id: { _id: threadId } } }
      }
    );
  });

  it('404s when the thread does not exist', async () => {
    DocumentthreadDAO.getThreadDocById.mockResolvedValue(null);
    StudentDAO.getStudentDocById.mockResolvedValue({ _id: student._id });

    const resp = await requestWithSupertest
      .delete(`/api/document-threads/${threadId}/${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(404);
    expect(DocumentthreadDAO.deleteThreadById).not.toHaveBeenCalled();
  });
});

describe('GET /api/document-threads/:messagesThreadId (getMessages)', () => {
  it('returns the thread with agents/editors/deadline assembled from the DAOs', async () => {
    asMock(protect).mockImplementation(
      async (req: Request, res: Response, next: NextFunction) => {
        req.user = agent;
        next();
      }
    );
    // CV is a General_Docs file_type, so the deadline path is CVDeadline_Calculator
    // (safe on an empty applications array) — no application_deadline lookup.
    DocumentthreadDAO.findThreadByIdFullyPopulated.mockResolvedValue({
      _id: threadId,
      file_type: 'CV',
      program_id: null,
      application_id: null,
      student_id: { _id: student._id, agents: [], editors: [] },
      messages: []
    });
    AuditDAO.getAuditLogs.mockResolvedValue([]);
    UserDAO.findAgents.mockResolvedValue([]);
    UserDAO.findEditors.mockResolvedValue([]);
    ApplicationDAO.findByStudentIdWithProgram.mockResolvedValue([]);

    const resp = await requestWithSupertest
      .get(`/api/document-threads/${threadId}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id.toString()).toBe(threadId);
    expect(DocumentthreadDAO.findThreadByIdFullyPopulated).toHaveBeenCalledWith(
      threadId
    );
    expect(ApplicationDAO.findByStudentIdWithProgram).toHaveBeenCalledWith(
      student._id.toString()
    );
  });
});

describe('GET /api/document-threads/pattern/check/:messagesThreadId/:file_type', () => {
  it('short-circuits to isPassed:true for non-CV checks without touching the DAO', async () => {
    asMock(protect).mockImplementation(
      async (req: Request, res: Response, next: NextFunction) => {
        req.user = agent;
        next();
      }
    );
    const resp = await requestWithSupertest
      .get(`/api/document-threads/pattern/check/${threadId}/ML`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.isPassed).toBe(true);
    // The controller returns early before any thread read for non-CV types.
    expect(DocumentthreadDAO.getThreadByIdLean).not.toHaveBeenCalled();
  });
});

describe('PUT /api/document-threads/:messagesThreadId/:messageId/:ignoreMessageState/ignored', () => {
  it('flips the message ignored flag via the DAO', async () => {
    asMock(protect).mockImplementation(
      async (req: Request, res: Response, next: NextFunction) => {
        req.user = agent;
        next();
      }
    );
    DocumentthreadDAO.setMessageIgnore.mockResolvedValue({
      _id: threadId,
      messages: [{ _id: messageId, ignored: true }]
    });

    const resp = await requestWithSupertest
      .put(`/api/document-threads/${threadId}/${messageId}/true/ignored`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(DocumentthreadDAO.setMessageIgnore).toHaveBeenCalledWith(
      expect.anything(),
      'true'
    );
  });
});
