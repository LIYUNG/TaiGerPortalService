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

const StudentService = require('../../services/students');
const ApplicationService = require('../../services/applications');
const UserService = require('../../services/users');
const PermissionService = require('../../services/permissions');
const BasedocumentationslinkService = require('../../services/basedocumentationslinks');
const { getAuditLogs } = require('../../services/audit');
const { userChangesHelperFunction } = require('../../utils/utils_function');
const {
  getStudent,
  getActiveStudents,
  getStudentsV3,
  getStudentsV3Paginated,
  getStudentsByIds,
  getStudentAndDocLinks,
  getStudentsAndDocLinks,
  updateDocumentationHelperLink,
  assignAttributesToStudent,
  assignAgentToStudent
} = require('../../controllers/students');
const { mockReq, mockRes } = require('../helpers/httpMocks');
const { admin, agent, student } = require('../mock/user');

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
    ApplicationService.getApplicationsByStudentId.mockResolvedValue([
      { _id: 'app1' }
    ]);
    BasedocumentationslinkService.findByCategory
      .mockResolvedValueOnce({ base: 'docs' }) // base-documents
      .mockResolvedValueOnce({ survey: 'link' }); // survey
    getAuditLogs.mockResolvedValue([{ _id: 'a1' }]);
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
    ApplicationService.getApplicationsByStudentId.mockResolvedValue([]);
    BasedocumentationslinkService.findByCategory.mockResolvedValue({});
    getAuditLogs.mockResolvedValue([]);
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
    userChangesHelperFunction.mockResolvedValue({
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
});
