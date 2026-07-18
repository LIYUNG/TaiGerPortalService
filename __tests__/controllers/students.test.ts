// Controller UNIT test for controllers/students.
//
// students is the "tangled" controller: a single handler can fan out to several
// services (Student/Application/User/Permission/Basedocumentationslink/Audit)
// plus side-effect helpers (email senders, userChangesHelperFunction). We call
// each handler DIRECTLY as a (req, res, next) function with ALL of those mocked
// and assert ONLY the controller's own work: the filter/args it forwards, the
// status + body it writes, the branching it does, and that it forwards a service
// error to next(). No route, no middleware, no DB, no real email.
//
// This is a representative subset of the main route handlers — the deep service
// logic (pagination, fetchStudents shaping) is already covered by the service
// suites (__tests__/services/studentsPaginated.test.js, activeThreadsPaginated)
// and the full-stack wiring by __tests__/integration/students.test.js.

jest.mock('../../services/students');
jest.mock('../../services/applications');
jest.mock('../../services/interviews');
jest.mock('../../services/programs');
jest.mock('../../services/users');
jest.mock('../../services/permissions');
jest.mock('../../services/basedocumentationslinks');
jest.mock('../../services/audit');
jest.mock('../../services/email');
jest.mock('../../utils/queryFunctions');
// Keep the real query builder (pure filter assembly) but stub the DB/email-hitting
// helpers used by the assign* handlers.
jest.mock('../../utils/utils_function', () => ({
  ...jest.requireActual('../../utils/utils_function'),
  add_portals_registered_status: jest.fn((apps) => apps),
  userChangesHelperFunction: jest.fn()
}));

import type { Request, Response, NextFunction } from 'express';

import StudentServiceModule from '../../services/students';
import ApplicationServiceModule from '../../services/applications';
import UserServiceModule from '../../services/users';
import PermissionServiceModule from '../../services/permissions';
import BasedocumentationslinkServiceModule from '../../services/basedocumentationslinks';
import { getAuditLogs } from '../../services/audit';
import { getPermission } from '../../utils/queryFunctions';
import { userChangesHelperFunction } from '../../utils/utils_function';
// controllers/students uses `export = {...}` (a plain object, not a
// class/function instance); a NAMED `import { getStudent } from ...` against
// that trips TS2497 (esModuleInterop only covers default-import interop).
// Default-import the whole object (as routes/students.ts does) and destructure
// off of it instead — same runtime access, no interop error.
import studentsController from '../../controllers/students';
const {
  getStudent: getStudentRaw,
  getActiveStudents: getActiveStudentsRaw,
  getStudentsV3: getStudentsV3Raw,
  getStudentsV3Paginated: getStudentsV3PaginatedRaw,
  getStudentsByIds: getStudentsByIdsRaw,
  getStudentAndDocLinks: getStudentAndDocLinksRaw,
  getStudentsAndDocLinks: getStudentsAndDocLinksRaw,
  updateDocumentationHelperLink: updateDocumentationHelperLinkRaw,
  updateStudentsArchivStatus: updateStudentsArchivStatusRaw,
  assignAttributesToStudent: assignAttributesToStudentRaw,
  assignAgentToStudent,
  assignEditorToStudent
} = studentsController;
// `helpers/httpMocks` is a plain CommonJS module (no ES import/export syntax),
// so `import { mockReq, mockRes } from ...` trips "is not a module" under
// esModuleInterop; require() sidesteps that (allowed in *.test.ts by eslintrc).
const { mockReq, mockRes } = require('../helpers/httpMocks');
import { Role } from '@taiger-common/core';
import { admin, agent, editor, student } from '../mock/user';

// Auto-mocked module methods expose jest.fn()s at runtime, but TS still sees
// the real signatures. Re-type each service as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockRejectedValue()/.mock` calls
// type-check while still allowing partial (non-Mongoose) return shapes.
type MockedModule = Record<string, jest.Mock>;
const StudentService = StudentServiceModule as unknown as MockedModule;
const ApplicationService = ApplicationServiceModule as unknown as MockedModule;
const UserService = UserServiceModule as unknown as MockedModule;
const PermissionService = PermissionServiceModule as unknown as MockedModule;
const BasedocumentationslinkService =
  BasedocumentationslinkServiceModule as unknown as MockedModule;

// `asMock` casts a single named auto-mocked function binding to jest.Mock.
const asMock = (fn: unknown) => fn as jest.Mock;

// Most of these handlers are asyncHandler-wrapped `(req, res)` (2-arg, no
// `next`) functions. asyncHandler's runtime closure always accepts
// `(req, res, next)` and forwards rejections to `next` — its TS type only
// exposes the wrapped handler's own parameter list (see
// middlewares/error-handler.ts). Cast back to the real 3-arg call shape so
// tests can pass `next`; TS-only, no runtime change (mirrors the
// informXEmail/getPermission casts already used in controllers/students.ts).
type ControllerHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void>;
const getStudent = getStudentRaw as unknown as ControllerHandler;
const getActiveStudents = getActiveStudentsRaw as unknown as ControllerHandler;
const getStudentsV3 = getStudentsV3Raw as unknown as ControllerHandler;
const getStudentsV3Paginated =
  getStudentsV3PaginatedRaw as unknown as ControllerHandler;
const getStudentsByIds = getStudentsByIdsRaw as unknown as ControllerHandler;
const getStudentAndDocLinks =
  getStudentAndDocLinksRaw as unknown as ControllerHandler;
const getStudentsAndDocLinks =
  getStudentsAndDocLinksRaw as unknown as ControllerHandler;
const updateDocumentationHelperLink =
  updateDocumentationHelperLinkRaw as unknown as ControllerHandler;
const updateStudentsArchivStatus =
  updateStudentsArchivStatusRaw as unknown as ControllerHandler;
const assignAttributesToStudent =
  assignAttributesToStudentRaw as unknown as ControllerHandler;

const studentId = student._id.toString();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getStudent', () => {
  it('responds 200 with the student resolved for req.params.studentId', async () => {
    const doc = { _id: studentId, firstname: 'Ann' };
    StudentService.getStudentById.mockResolvedValue(doc);
    const res = mockRes();

    await getStudent(mockReq({ params: { studentId } }), res, jest.fn());

    expect(StudentService.getStudentById).toHaveBeenCalledWith(studentId);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: doc });
  });

  it('responds 404 when the student is not found', async () => {
    StudentService.getStudentById.mockResolvedValue(null);
    const res = mockRes();

    await getStudent(mockReq({ params: { studentId } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Student not found.'
    });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    StudentService.getStudentById.mockRejectedValue(err);
    const next = jest.fn();

    await getStudent(mockReq({ params: { studentId } }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('getActiveStudents', () => {
  it('builds a filter from the query and forwards it to the service', async () => {
    const students = [{ _id: 's1' }];
    StudentService.getStudentsWithApplications.mockResolvedValue(students);
    const res = mockRes();

    // archiv:'false' makes the builder emit an $or; editors/agents omitted.
    await getActiveStudents(
      mockReq({ query: { archiv: 'false' } }),
      res,
      jest.fn()
    );

    expect(StudentService.getStudentsWithApplications).toHaveBeenCalledTimes(1);
    const filter = StudentService.getStudentsWithApplications.mock.calls[0][0];
    expect(filter).toHaveProperty('$or');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: students });
  });
});

describe('getStudentsV3', () => {
  it('responds 200 with fetchStudents output for the built filter', async () => {
    const students = [{ _id: 's1' }, { _id: 's2' }];
    StudentService.fetchStudents.mockResolvedValue(students);
    const res = mockRes();

    await getStudentsV3(
      mockReq({ query: { agents: 'agent-1' } }),
      res,
      jest.fn()
    );

    expect(StudentService.fetchStudents).toHaveBeenCalledWith(
      expect.objectContaining({ agents: 'agent-1' })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: students });
  });
});

describe('getStudentsV3Paginated', () => {
  it('forwards the built filter and the raw query to getStudentsPaginated', async () => {
    const result = { data: [], total: 0, page: 1 };
    StudentService.getStudentsPaginated.mockResolvedValue(result);
    const query = { agents: 'agent-1', page: '1', limit: '10' };
    const res = mockRes();

    await getStudentsV3Paginated(mockReq({ query }), res, jest.fn());

    expect(StudentService.getStudentsPaginated).toHaveBeenCalledWith({
      filter: expect.objectContaining({ agents: 'agent-1' }),
      query
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: result });
  });
});

describe('getStudentsByIds', () => {
  it('responds 400 when the ids query param is missing', async () => {
    const res = mockRes();

    await getStudentsByIds(mockReq({ query: {} }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(StudentService.getStudentsWithApplications).not.toHaveBeenCalled();
  });

  it('responds 400 when no valid object ids are supplied', async () => {
    const res = mockRes();

    await getStudentsByIds(
      mockReq({ query: { ids: 'not-an-id,also-bad' } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.invalidIds).toEqual(['not-an-id', 'also-bad']);
  });

  it('ignores empty segments + invalid ids and reports them alongside 200 results', async () => {
    const students = [{ _id: studentId }];
    StudentService.getStudentsWithApplications.mockResolvedValue(students);
    const res = mockRes();

    // `${studentId}` is valid, `bad-id` is invalid, the trailing comma yields an
    // empty segment (the !trimmedId short-circuit), and whitespace is trimmed.
    await getStudentsByIds(
      mockReq({ query: { ids: `${studentId}, bad-id ,` }, requestId: 'r-1' }),
      res,
      jest.fn()
    );

    expect(StudentService.getStudentsWithApplications).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.invalidIds).toEqual(['bad-id']);
    expect(body.message).toMatch(/ignored/i);
  });

  it('queries by the parsed valid ids and responds 200', async () => {
    const students = [{ _id: studentId }];
    StudentService.getStudentsWithApplications.mockResolvedValue(students);
    const res = mockRes();

    await getStudentsByIds(
      mockReq({ query: { ids: studentId } }),
      res,
      jest.fn()
    );

    expect(StudentService.getStudentsWithApplications).toHaveBeenCalledTimes(1);
    const filter = StudentService.getStudentsWithApplications.mock.calls[0][0];
    expect(filter._id.$in).toHaveLength(1);
    expect(filter._id.$in[0].toString()).toBe(studentId);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: students });
  });
});

describe('getStudentAndDocLinks', () => {
  it('responds 200 bundling student/applications/doc links/audit', async () => {
    StudentService.getStudentByIdWithDocThreads.mockResolvedValue({
      _id: studentId,
      firstname: 'Ann'
    });
    ApplicationService.getApplicationsWithCredentialsByStudentId.mockResolvedValue(
      [{ _id: 'app1' }]
    );
    BasedocumentationslinkService.findByCategory
      .mockResolvedValueOnce({ base: 'docs' }) // base-documents
      .mockResolvedValueOnce({ survey: 'link' }); // survey
    asMock(getAuditLogs).mockResolvedValue([{ _id: 'a1' }]);
    const res = mockRes();

    await getStudentAndDocLinks(
      mockReq({ user: admin, params: { studentId } }),
      res,
      jest.fn()
    );

    expect(StudentService.getStudentByIdWithDocThreads).toHaveBeenCalledWith(
      studentId
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data._id).toBe(studentId);
    expect(body.base_docs_link).toEqual({ base: 'docs' });
    expect(body.survey_link).toEqual({ survey: 'link' });
    expect(body.audit).toEqual([{ _id: 'a1' }]);
  });

  it('responds 404 when the student does not exist', async () => {
    StudentService.getStudentByIdWithDocThreads.mockResolvedValue(null);
    ApplicationService.getApplicationsWithCredentialsByStudentId.mockResolvedValue(
      []
    );
    BasedocumentationslinkService.findByCategory.mockResolvedValue({});
    asMock(getAuditLogs).mockResolvedValue([]);
    const res = mockRes();

    await getStudentAndDocLinks(
      mockReq({ user: admin, params: { studentId } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({
      success: false,
      message: 'Student not found'
    });
  });
});

describe('getStudentsAndDocLinks', () => {
  it('staff branch: returns simple students with an empty base_docs_link', async () => {
    const students = [{ _id: 's1' }];
    StudentService.fetchSimpleStudents.mockResolvedValue(students);
    const res = mockRes();

    await getStudentsAndDocLinks(
      mockReq({ user: admin, query: {} }),
      res,
      jest.fn()
    );

    expect(StudentService.fetchSimpleStudents).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: students,
      base_docs_link: {}
    });
  });
});

describe('updateDocumentationHelperLink', () => {
  it('upserts the link and responds 200 with the refreshed category', async () => {
    BasedocumentationslinkService.upsertByCategoryKey.mockResolvedValue({});
    BasedocumentationslinkService.findByCategory.mockResolvedValue({
      key: 'val'
    });
    const res = mockRes();

    await updateDocumentationHelperLink(
      mockReq({
        body: { link: 'http://x', key: 'k', category: 'base-documents' }
      }),
      res,
      jest.fn()
    );

    expect(
      BasedocumentationslinkService.upsertByCategoryKey
    ).toHaveBeenCalledWith(
      'base-documents',
      'k',
      expect.objectContaining({ link: 'http://x' })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      helper_link: { key: 'val' }
    });
  });
});

describe('assignAttributesToStudent', () => {
  it('updates attributes then returns the refreshed student', async () => {
    StudentService.updateStudentById.mockResolvedValue({});
    const updated = { _id: studentId, attributes: ['a1'] };
    StudentService.getStudentById.mockResolvedValue(updated);
    const res = mockRes();

    await assignAttributesToStudent(
      mockReq({ params: { studentId }, body: ['a1'] }),
      res,
      jest.fn()
    );

    expect(StudentService.updateStudentById).toHaveBeenCalledWith(studentId, {
      attributes: ['a1']
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: updated });
  });
});

describe('assignAgentToStudent', () => {
  it('responds 400 on invalid input (non-object body)', async () => {
    const res = mockRes();

    await assignAgentToStudent(
      mockReq({ user: admin, params: { studentId }, body: 'nope' }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(StudentService.getStudentById).not.toHaveBeenCalled();
  });

  it('responds 404 when the student does not exist', async () => {
    StudentService.getStudentById.mockResolvedValue(null);
    const res = mockRes();

    await assignAgentToStudent(
      mockReq({ user: admin, params: { studentId }, body: {} }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Student not found.'
    });
  });

  it('updates agents, returns the refreshed student, and calls next() for audit', async () => {
    const existing = {
      _id: studentId,
      agents: [],
      firstname: 'Ann',
      archiv: false
    };
    const updated = {
      _id: { toString: () => studentId },
      agents: [agent._id],
      firstname: 'Ann',
      lastname: 'B',
      email: 'a@b.c',
      archiv: false
    };
    StudentService.getStudentById
      .mockResolvedValueOnce(existing) // initial fetch
      .mockResolvedValueOnce(updated); // refreshed after update
    asMock(userChangesHelperFunction).mockResolvedValue({
      addedUsers: [
        {
          _id: agent._id,
          firstname: 'New',
          lastname: 'Agent',
          email: 'n@a.c',
          archiv: false
        }
      ],
      removedUsers: [],
      updatedUsers: [],
      toBeInformedUsers: [],
      updatedUserIds: [agent._id]
    });
    StudentService.updateStudentById.mockResolvedValue({});
    PermissionService.findPermissionsWithUser.mockResolvedValue([]);
    const res = mockRes();
    const next = jest.fn();

    await assignAgentToStudent(
      mockReq({
        user: admin,
        params: { studentId },
        body: { [agent._id]: true }
      }),
      res,
      next
    );

    expect(StudentService.updateStudentById).toHaveBeenCalledWith(
      studentId,
      expect.objectContaining({ agents: [agent._id] })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: updated });
    // an audit entry was attached and next() invoked for the audit middleware
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('emails agent-leads, newly-informed agents and the student after assigning', async () => {
    const {
      informAgentManagerNewStudentEmail,
      informAgentNewStudentEmail,
      informStudentTheirAgentEmail
    } = require('../../services/email');
    const existing = { _id: studentId, agents: [], archiv: false };
    const updated = {
      _id: { toString: () => studentId },
      agents: [agent._id],
      firstname: 'Ann',
      lastname: 'B',
      email: 'a@b.c',
      archiv: false
    };
    StudentService.getStudentById
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(updated);
    asMock(userChangesHelperFunction).mockResolvedValue({
      addedUsers: [{ _id: agent._id }],
      removedUsers: [],
      // non-empty updatedUsers -> informStudentTheirAgentEmail branch
      updatedUsers: [{ _id: agent._id, firstname: 'New', lastname: 'Agent' }],
      // non-empty toBeInformedUsers (non-archived) -> informAgentNewStudentEmail
      toBeInformedUsers: [
        {
          _id: agent._id,
          firstname: 'New',
          lastname: 'Agent',
          email: 'n@a.c',
          archiv: false
        }
      ],
      updatedUserIds: [agent._id]
    });
    StudentService.updateStudentById.mockResolvedValue({});
    // an agent-lead distinct from the requesting admin, non-archived.
    PermissionService.findPermissionsWithUser.mockResolvedValue([
      {
        user_id: {
          _id: { toString: () => 'lead-1' },
          firstname: 'Lead',
          lastname: 'Er',
          email: 'lead@x.c',
          archiv: false
        }
      }
    ]);
    const res = mockRes();
    const next = jest.fn();

    await assignAgentToStudent(
      mockReq({
        user: admin,
        params: { studentId },
        body: { [agent._id]: true }
      }),
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(informAgentManagerNewStudentEmail).toHaveBeenCalledTimes(1);
    expect(informAgentNewStudentEmail).toHaveBeenCalledTimes(1);
    expect(informStudentTheirAgentEmail).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('responds 500 when an internal error is thrown', async () => {
    StudentService.getStudentById.mockResolvedValueOnce({
      _id: studentId,
      agents: []
    });
    asMock(userChangesHelperFunction).mockRejectedValue(new Error('boom'));
    const res = mockRes();

    await assignAgentToStudent(
      mockReq({ user: admin, params: { studentId }, body: { x: true } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Internal server error.'
    });
  });
});

describe('getStudentAndDocLinks agent notification pull', () => {
  it('clears the agent base-docs notification after responding 200', async () => {
    StudentService.getStudentByIdWithDocThreads.mockResolvedValue({
      _id: studentId
    });
    ApplicationService.getApplicationsWithCredentialsByStudentId.mockResolvedValue(
      [{ _id: 'app1', isLocked: undefined }]
    );
    BasedocumentationslinkService.findByCategory.mockResolvedValue({});
    asMock(getAuditLogs).mockResolvedValue([]);
    UserService.updateUser.mockResolvedValue({});
    const res = mockRes();

    await getStudentAndDocLinks(
      mockReq({ user: agent, params: { studentId } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(UserService.updateUser).toHaveBeenCalledWith(
      agent._id.toString(),
      expect.objectContaining({ $pull: expect.any(Object) })
    );
  });
});

describe('getStudentsAndDocLinks role branches', () => {
  it('student branch: marks base-docs read and returns the single student + links', async () => {
    const studentUser = { ...student, notification: {} };
    StudentService.updateStudentById.mockResolvedValue({ _id: studentId });
    BasedocumentationslinkService.findByCategory.mockResolvedValue({
      base: 'd'
    });
    const res = mockRes();

    await getStudentsAndDocLinks(
      mockReq({ user: studentUser, query: {} }),
      res,
      jest.fn()
    );

    expect(StudentService.updateStudentById).toHaveBeenCalledWith(
      studentUser._id.toString(),
      expect.objectContaining({
        notification: expect.objectContaining({
          isRead_base_documents_rejected: true
        })
      })
    );
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: [{ _id: studentId }],
      base_docs_link: { base: 'd' }
    });
  });

  it('guest branch: echoes the user back', async () => {
    const guest = { _id: 'g1', role: Role.Guest };
    const res = mockRes();

    await getStudentsAndDocLinks(
      mockReq({ user: guest, query: {} }),
      res,
      jest.fn()
    );

    expect(res.send).toHaveBeenCalledWith({ success: true, data: [guest] });
  });
});

describe('updateStudentsArchivStatus', () => {
  it('archived + admin: returns active students and emails editors', async () => {
    const archivedStudent = {
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@d.co',
      editors: [{ firstname: 'E', lastname: 'D', email: 'e@d.co' }]
    };
    StudentService.updateStudentById.mockResolvedValue(archivedStudent);
    StudentService.fetchStudents.mockResolvedValue([{ _id: 's1' }]);
    const res = mockRes();

    await updateStudentsArchivStatus(
      mockReq({
        user: admin,
        params: { studentId },
        body: { isArchived: true, shouldInform: true }
      }),
      res,
      jest.fn()
    );

    expect(StudentService.fetchStudents).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: [{ _id: 's1' }]
    });
  });

  it('archived + agent with canAssignAgents: returns all active students', async () => {
    StudentService.updateStudentById.mockResolvedValue({ editors: [] });
    StudentService.fetchStudents.mockResolvedValue([{ _id: 's2' }]);
    asMock(getPermission).mockResolvedValue({ canAssignAgents: true });
    const res = mockRes();

    await updateStudentsArchivStatus(
      mockReq({
        user: agent,
        params: { studentId },
        body: { isArchived: true, shouldInform: false }
      }),
      res,
      jest.fn()
    );

    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: [{ _id: 's2' }]
    });
  });

  it('archived + agent without canAssignAgents: scopes to own students', async () => {
    StudentService.updateStudentById.mockResolvedValue({ editors: [] });
    StudentService.fetchStudents.mockResolvedValue([{ _id: 's3' }]);
    asMock(getPermission).mockResolvedValue({ canAssignAgents: false });
    const res = mockRes();

    await updateStudentsArchivStatus(
      mockReq({
        user: agent,
        params: { studentId },
        body: { isArchived: true, shouldInform: false }
      }),
      res,
      jest.fn()
    );

    const filter = StudentService.fetchStudents.mock.calls[0][0];
    expect(filter.agents).toEqual(agent._id);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: [{ _id: 's3' }]
    });
  });

  it('archived + editor: scopes to own students', async () => {
    StudentService.updateStudentById.mockResolvedValue({ editors: [] });
    StudentService.fetchStudents.mockResolvedValue([{ _id: 's4' }]);
    const res = mockRes();

    await updateStudentsArchivStatus(
      mockReq({
        user: editor,
        params: { studentId },
        body: { isArchived: true, shouldInform: false }
      }),
      res,
      jest.fn()
    );

    const filter = StudentService.fetchStudents.mock.calls[0][0];
    expect(filter.editors).toEqual(editor._id);
  });

  it('unarchived + admin: returns archived students', async () => {
    StudentService.updateStudentById.mockResolvedValue({ editors: [] });
    StudentService.getStudents.mockResolvedValue([{ _id: 'arch1' }]);
    const res = mockRes();

    await updateStudentsArchivStatus(
      mockReq({
        user: admin,
        params: { studentId },
        body: { isArchived: false }
      }),
      res,
      jest.fn()
    );

    expect(StudentService.getStudents).toHaveBeenCalledWith({
      filter: { archiv: true },
      options: {}
    });
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: [{ _id: 'arch1' }]
    });
  });

  it('unarchived + agent: returns the agent archived students', async () => {
    StudentService.updateStudentById.mockResolvedValue({ editors: [] });
    StudentService.getStudents.mockResolvedValue([{ _id: 'arch2' }]);
    const res = mockRes();

    await updateStudentsArchivStatus(
      mockReq({
        user: agent,
        params: { studentId },
        body: { isArchived: false }
      }),
      res,
      jest.fn()
    );

    const arg = StudentService.getStudents.mock.calls[0][0];
    expect(arg.filter).toEqual({ agents: agent._id, archiv: true });
  });

  it('unarchived + editor: returns the editor archived students', async () => {
    StudentService.updateStudentById.mockResolvedValue({ editors: [] });
    StudentService.getStudents.mockResolvedValue([{ _id: 'arch3' }]);
    const res = mockRes();

    await updateStudentsArchivStatus(
      mockReq({
        user: editor,
        params: { studentId },
        body: { isArchived: false }
      }),
      res,
      jest.fn()
    );

    const arg = StudentService.getStudents.mock.calls[0][0];
    expect(arg.filter).toEqual({ editors: editor._id, archiv: true });
  });

  it('unarchived + guest: returns an empty list', async () => {
    StudentService.updateStudentById.mockResolvedValue({ editors: [] });
    const res = mockRes();

    await updateStudentsArchivStatus(
      mockReq({
        user: { _id: 'g', role: Role.Guest },
        params: { studentId },
        body: { isArchived: false }
      }),
      res,
      jest.fn()
    );

    expect(res.send).toHaveBeenCalledWith({ success: true, data: [] });
  });
});

describe('assignEditorToStudent', () => {
  it('responds 400 on invalid input (non-object body)', async () => {
    const res = mockRes();

    await assignEditorToStudent(
      mockReq({ user: admin, params: { studentId }, body: 'nope' }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(StudentService.getStudentById).not.toHaveBeenCalled();
  });

  it('responds 404 when the student does not exist', async () => {
    StudentService.getStudentById.mockResolvedValue(null);
    const res = mockRes();

    await assignEditorToStudent(
      mockReq({ user: admin, params: { studentId }, body: {} }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('updates editors, returns the refreshed student and calls next() for audit', async () => {
    const existing = {
      _id: studentId,
      editors: [],
      agents: [],
      firstname: 'Ann',
      lastname: 'B',
      email: 'a@b.c',
      archiv: false
    };
    const updated = {
      _id: { toString: () => studentId },
      editors: [editor._id],
      agents: [],
      firstname: 'Ann',
      archiv: false
    };
    StudentService.getStudentById
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(updated);
    asMock(userChangesHelperFunction).mockResolvedValue({
      addedUsers: [
        {
          _id: editor._id,
          firstname: 'E',
          lastname: 'D',
          email: 'e@d.c',
          archiv: false
        }
      ],
      removedUsers: [],
      updatedUsers: [{ _id: editor._id, firstname: 'E' }],
      toBeInformedUsers: [
        {
          _id: editor._id,
          firstname: 'E',
          lastname: 'D',
          email: 'e@d.c',
          archiv: false
        }
      ],
      updatedUserIds: [editor._id]
    });
    StudentService.updateStudentById.mockResolvedValue({});
    const res = mockRes();
    const next = jest.fn();

    await assignEditorToStudent(
      mockReq({
        user: admin,
        params: { studentId },
        body: { [editor._id]: true }
      }),
      res,
      next
    );

    expect(StudentService.updateStudentById).toHaveBeenCalledWith(
      studentId,
      expect.objectContaining({ editors: [editor._id] })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('also emails the assigned agents of the student after assigning editors', async () => {
    const { informAgentStudentAssignedEmail } = require('../../services/email');
    const existing = {
      _id: studentId,
      editors: [],
      agents: [],
      firstname: 'Ann',
      lastname: 'B',
      email: 'a@b.c',
      archiv: false
    };
    const updated = {
      _id: { toString: () => studentId },
      editors: [editor._id],
      // non-empty agents (non-archived) -> informAgentStudentAssignedEmail loop
      agents: [
        {
          _id: agent._id,
          firstname: 'Ag',
          lastname: 'Ent',
          email: 'ag@e.c',
          archiv: false
        }
      ],
      firstname: 'Ann',
      archiv: false
    };
    StudentService.getStudentById
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(updated);
    asMock(userChangesHelperFunction).mockResolvedValue({
      addedUsers: [{ _id: editor._id }],
      removedUsers: [],
      updatedUsers: [],
      toBeInformedUsers: [],
      updatedUserIds: [editor._id]
    });
    StudentService.updateStudentById.mockResolvedValue({});
    const res = mockRes();
    const next = jest.fn();

    await assignEditorToStudent(
      mockReq({
        user: admin,
        params: { studentId },
        body: { [editor._id]: true }
      }),
      res,
      next
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(informAgentStudentAssignedEmail).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('responds 500 when an internal error is thrown', async () => {
    StudentService.getStudentById.mockResolvedValueOnce({
      _id: studentId,
      editors: []
    });
    asMock(userChangesHelperFunction).mockRejectedValue(new Error('boom'));
    const res = mockRes();

    await assignEditorToStudent(
      mockReq({ user: admin, params: { studentId }, body: { x: true } }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
