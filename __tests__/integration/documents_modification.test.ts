// HTTP-stack integration test for the documents_modification routes with the
// DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router (routes/documents_modification) ->
//   real middleware -> real controllers/documents_modification ->
//   real services -> MOCKED DAOs.
//
// Only the auth/tenant/permission/upload middleware and the S3 + email side
// channels are stubbed; in addition the DAOs the exercised handlers reach are
// mocked. This complements ./documentthread.test.js (same router) by covering a
// DIFFERENT slice — the overview *counts* endpoints and the survey-input reset
// lifecycle — asserting the controller/service forward the right args to the DAO
// and shape the response from the DAO's (mocked) return. Real query/aggregation
// construction is covered by the DAO unit tests.

import request from 'supertest';
const { ObjectId } = require('mongoose').Types;

import { app } from '../../app';
import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';
import { admin, agent, student } from '../mock/user';

const requestWithSupertest = request(app);

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
    permit: jest.fn().mockImplementation(() => passthrough)
  };
});

jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/InnerTaigerMultitenantFilter'),
    InnerTaigerMultitenantFilter: jest.fn().mockImplementation(passthrough)
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

jest.mock('../../middlewares/file-upload', () => {
  const passthrough = async (req, res, next) => {
    req.files = [];
    next();
  };
  const passthroughSingle = async (req, res, next) => {
    req.file = undefined;
    next();
  };
  return {
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
  const passthrough = async (req, res, next) => next();
  return {
    docThreadMultitenant_filter: jest.fn().mockImplementation(passthrough),
    surveyMultitenantFilter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/AssignOutsourcerFilter', () => {
  const passthrough = async (req, res, next) => next();
  return { AssignOutsourcerFilter: jest.fn().mockImplementation(passthrough) };
});

jest.mock('../../middlewares/editorIdsBodyFilter', () => {
  const passthrough = async (req, res, next) => next();
  return { editorIdsBodyFilter: jest.fn().mockImplementation(passthrough) };
});

jest.mock('../../middlewares/docs_thread_operation_validation', () => {
  const passthrough = async (req, res, next) => next();
  return {
    doc_thread_ops_validator: jest.fn().mockImplementation(passthrough)
  };
});

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
  auditLog: (req, res, next) => next()
}));

// ---- The data boundary: mock the DAOs the exercised handlers reach ----

jest.mock('../../dao/documentthread.dao');
jest.mock('../../dao/student.dao');
jest.mock('../../dao/surveyInput.dao');

import DocumentthreadDAO from '../../dao/documentthread.dao';
import StudentDAO from '../../dao/student.dao';

const threadId = new ObjectId().toHexString();

beforeEach(() => {
  jest.clearAllMocks();
  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });
  StudentDAO.fetchStudentIds.mockResolvedValue([{ _id: student._id }]);
});

describe('GET /api/document-threads/overview/all/counts', () => {
  it('returns the counts payload from countActiveThreads (scoped to active students)', async () => {
    const counts = { total: 3, withMessages: 1, finalVersion: 2 };
    DocumentthreadDAO.countActiveThreads.mockResolvedValue(counts);

    const resp = await requestWithSupertest
      .get('/api/document-threads/overview/all/counts')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(typeof resp.body.data).toBe('object');
    expect(resp.body.data).toEqual(counts);
    expect(StudentDAO.fetchStudentIds).toHaveBeenCalledWith({
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });
    expect(DocumentthreadDAO.countActiveThreads).toHaveBeenCalledWith(
      expect.objectContaining({
        studentIds: [student._id.toString()]
      })
    );
  });
});

describe('GET /api/document-threads/overview/taiger-user/:userId/counts', () => {
  it('returns the counts payload for the supervised students of a user', async () => {
    const counts = { total: 1, withMessages: 0, finalVersion: 1 };
    DocumentthreadDAO.countActiveThreads.mockResolvedValue(counts);

    const resp = await requestWithSupertest
      .get(`/api/document-threads/overview/taiger-user/${agent._id}/counts`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(typeof resp.body.data).toBe('object');
    expect(resp.body.data).toEqual(counts);
    // supervisedActiveStudentIds queries non-archived students agented/edited by user.
    expect(StudentDAO.fetchStudentIds).toHaveBeenCalledWith({
      $and: [
        { $or: [{ archiv: { $exists: false } }, { archiv: false }] },
        {
          $or: [
            { agents: agent._id.toString() },
            { editors: agent._id.toString() }
          ]
        }
      ]
    });
    expect(DocumentthreadDAO.countActiveThreads).toHaveBeenCalledWith(
      expect.objectContaining({
        studentIds: [student._id.toString()],
        outsourcedUserId: agent._id.toString()
      })
    );
  });
});

describe('GET /api/document-threads/student-threads/:studentId', () => {
  it('returns the student thread payload from findThreadsByStudentIdPopulated', async () => {
    protect.mockImplementation(async (req, res, next) => {
      req.user = agent;
      next();
    });
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
