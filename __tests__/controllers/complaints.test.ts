// Controller UNIT test for controllers/complaints.
//
// The handlers are plain (req, res, next) functions, so we call them DIRECTLY
// with fake req/res/next and MOCKED collaborators (ComplaintService,
// PermissionService, StudentService, the complaints email module, and the S3 /
// garbage-collector side effects the write handlers fire after responding). No
// route, no middleware, no database — only the controller's own work:
//   - the role-based branch it takes (student vs staff),
//   - the args it forwards to the service,
//   - the status + body it writes to res,
//   - that it forwards a service error to next().
// Route + middleware wiring + real persistence is covered by
// __tests__/integration/complaints.test.js.

jest.mock('../../services/complaints');
jest.mock('../../services/permissions');
jest.mock('../../services/students');
jest.mock('../../services/email/complaints', () => ({
  newCustomerCenterTicketEmail: jest.fn(),
  newCustomerCenterTicketSubmitConfirmationEmail: jest.fn(),
  complaintResolvedRequesterReminderEmail: jest.fn(),
  newCustomerCenterTicketMessageEmail: jest.fn()
}));
jest.mock('../../utils/utils_function', () => ({
  ...jest.requireActual('../../utils/utils_function'),
  threadS3GarbageCollector: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../utils/modelHelper/versionControl', () => ({
  ...jest.requireActual('../../utils/modelHelper/versionControl'),
  emptyS3Directory: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../aws/s3', () => ({
  ...jest.requireActual('../../aws/s3'),
  getS3Object: jest.fn().mockResolvedValue(Buffer.from(''))
}));
jest.mock('../../cache/node-cache', () => ({
  ten_minutes_cache: { get: jest.fn(), set: jest.fn() }
}));

import type { Request, Response, NextFunction } from 'express';

import ComplaintServiceModule from '../../services/complaints';
import PermissionServiceModule from '../../services/permissions';
import StudentServiceModule from '../../services/students';
import { getS3Object } from '../../aws/s3';
import { ten_minutes_cache } from '../../cache/node-cache';
import { threadS3GarbageCollector } from '../../utils/utils_function';
import emailComplaints from '../../services/email/complaints';
// controllers/complaints uses `export = {...}` (a plain object, not a
// class/function instance); a NAMED `import { getComplaints } from ...`
// against that trips TS2497 (esModuleInterop only covers default-import
// interop). Default-import the whole object and destructure off of it
// instead — same runtime access, no interop error.
import complaintsController from '../../controllers/complaints';
const {
  getComplaints: getComplaintsRaw,
  getComplaint: getComplaintRaw,
  createComplaint: createComplaintRaw,
  updateComplaint: updateComplaintRaw,
  getMessageFileInTicket: getMessageFileInTicketRaw,
  postMessageInTicket: postMessageInTicketRaw,
  updateAMessageInComplaint: updateAMessageInComplaintRaw,
  deleteAMessageInComplaint: deleteAMessageInComplaintRaw,
  deleteComplaint: deleteComplaintRaw
} = complaintsController;
// `helpers/httpMocks` is a plain CommonJS module (no ES import/export syntax),
// so `import { mockReq, mockRes } from ...` trips "is not a module" under
// esModuleInterop; require() sidesteps that (allowed in *.test.ts by eslintrc).
const { mockReq, mockRes } = require('../helpers/httpMocks');
import { admin, student } from '../mock/user';

// Auto-mocked module methods expose jest.fn()s at runtime, but TS still sees
// the real signatures. Re-type each service as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockRejectedValue()` calls type-check.
type MockedModule = Record<string, jest.Mock>;
const ComplaintService = ComplaintServiceModule as unknown as MockedModule;
const PermissionService = PermissionServiceModule as unknown as MockedModule;
const StudentService = StudentServiceModule as unknown as MockedModule;

// `asMock` casts a single named auto-mocked function binding to jest.Mock.
const asMock = (fn: unknown) => fn as jest.Mock;

// Every handler here is an asyncHandler-wrapped `(req, res)` (2-arg, no
// `next`) function. asyncHandler's runtime closure always accepts
// `(req, res, next)` and forwards rejections to `next` — its TS type only
// exposes the wrapped handler's own parameter list (see
// middlewares/error-handler.ts). Cast back to the real 3-arg call shape so
// tests can pass `next`; TS-only, no runtime change.
type ControllerHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void>;
const getComplaints = getComplaintsRaw as unknown as ControllerHandler;
const getComplaint = getComplaintRaw as unknown as ControllerHandler;
const createComplaint = createComplaintRaw as unknown as ControllerHandler;
const updateComplaint = updateComplaintRaw as unknown as ControllerHandler;
const getMessageFileInTicket =
  getMessageFileInTicketRaw as unknown as ControllerHandler;
const postMessageInTicket =
  postMessageInTicketRaw as unknown as ControllerHandler;
const updateAMessageInComplaint =
  updateAMessageInComplaintRaw as unknown as ControllerHandler;
const deleteAMessageInComplaint =
  deleteAMessageInComplaintRaw as unknown as ControllerHandler;
const deleteComplaint = deleteComplaintRaw as unknown as ControllerHandler;

const ticketId = '5f9f1b9b9b9b9b9b9b9b9b9b';
const messageId = '6f9f1b9b9b9b9b9b9b9b9b9b';
const validMessage =
  '{"time":1709677608094,"blocks":[{"id":"a","type":"paragraph","data":{"text":"New message"}}],"version":"2.29.0"}';

beforeEach(() => {
  jest.clearAllMocks();
  // The create / post-message handlers fire-and-forget email after responding;
  // give the post-response services benign resolutions so they don't reject.
  PermissionService.getManagers.mockResolvedValue([]);
  StudentService.getStudentByIdWithTeam.mockResolvedValue({
    firstname: 'S',
    lastname: 'T',
    archiv: false
  });
});

describe('getComplaints', () => {
  it('staff branch: returns all tickets the service resolves', async () => {
    const tickets = [{ _id: 't1', title: 'late deadline' }];
    ComplaintService.getComplaints.mockResolvedValue(tickets);
    const res = mockRes();

    await getComplaints(mockReq({ user: admin, query: {} }), res, jest.fn());

    expect(ComplaintService.getComplaints).toHaveBeenCalledWith({});
    expect(res.send).toHaveBeenCalledWith({ success: true, data: tickets });
  });

  it('student branch: returns only the requester tickets', async () => {
    const tickets = [{ _id: 't2', title: 'mine' }];
    ComplaintService.getComplaintsByRequester.mockResolvedValue(tickets);
    const res = mockRes();

    await getComplaints(mockReq({ user: student, query: {} }), res, jest.fn());

    expect(ComplaintService.getComplaintsByRequester).toHaveBeenCalledWith(
      student._id
    );
    expect(ComplaintService.getComplaints).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith({ success: true, data: tickets });
  });

  it('staff branch: forwards a status filter from the query', async () => {
    ComplaintService.getComplaints.mockResolvedValue([]);
    const res = mockRes();

    await getComplaints(
      mockReq({ user: admin, query: { status: 'resolved' } }),
      res,
      jest.fn()
    );

    expect(ComplaintService.getComplaints).toHaveBeenCalledWith({
      status: 'resolved'
    });
  });
});

describe('getComplaint', () => {
  it('returns the populated ticket and forwards the id', async () => {
    const ticket = { _id: ticketId, title: 'x' };
    ComplaintService.getComplaintByIdPopulated.mockResolvedValue(ticket);
    const res = mockRes();

    await getComplaint(mockReq({ params: { ticketId } }), res, jest.fn());

    expect(ComplaintService.getComplaintByIdPopulated).toHaveBeenCalledWith(
      ticketId
    );
    expect(res.send).toHaveBeenCalledWith({ success: true, data: ticket });
  });

  it('forwards a 404 ErrorResponse to next() when the ticket is missing', async () => {
    ComplaintService.getComplaintByIdPopulated.mockResolvedValue(null);
    const next = jest.fn();

    await getComplaint(mockReq({ params: { ticketId } }), mockRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
  });
});

describe('createComplaint', () => {
  it('stamps the requester id and responds 201 with the created ticket', async () => {
    const created = { _id: 'new1', title: 'broken', description: 'desc' };
    ComplaintService.createComplaint.mockResolvedValue(created);
    const res = mockRes();

    await createComplaint(
      mockReq({
        user: admin,
        body: { ticket: { title: 'broken', description: 'desc' } }
      }),
      res,
      jest.fn()
    );

    expect(ComplaintService.createComplaint).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'broken',
        requester_id: admin._id.toString()
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: created });
  });
});

describe('updateComplaint', () => {
  it('forwards the id + fields (stamped updatedAt) and responds 200 with the ticket', async () => {
    const updated = { _id: ticketId, description: 'new information' };
    ComplaintService.updateComplaintById.mockResolvedValue(updated);
    const res = mockRes();

    await updateComplaint(
      mockReq({
        user: admin,
        params: { ticketId },
        body: { description: 'new information' }
      }),
      res,
      jest.fn()
    );

    expect(ComplaintService.updateComplaintById).toHaveBeenCalledWith(
      ticketId,
      expect.objectContaining({
        description: 'new information',
        updatedAt: expect.any(Date)
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: updated });
  });

  it('forwards a 404 ErrorResponse to next() when the ticket is missing', async () => {
    ComplaintService.updateComplaintById.mockResolvedValue(null);
    const next = jest.fn();

    await updateComplaint(
      mockReq({
        user: admin,
        params: { ticketId },
        body: { description: 'x' }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
  });
});

describe('updateAMessageInComplaint', () => {
  it('updates the message when the caller owns it', async () => {
    ComplaintService.getComplaintDocById.mockResolvedValue({
      status: 'open',
      messages: [{ _id: messageId, user_id: admin._id }]
    });
    ComplaintService.updateComplaintRaw.mockResolvedValue(undefined);
    const res = mockRes();

    await updateAMessageInComplaint(
      mockReq({
        user: admin,
        params: { ticketId, messageId },
        body: { messages: [{ message: 'updated' }] }
      }),
      res,
      jest.fn()
    );

    expect(ComplaintService.updateComplaintRaw).toHaveBeenCalledWith(
      ticketId,
      expect.any(Object)
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });

  it('forwards a 409 ErrorResponse to next() when the message belongs to another user', async () => {
    ComplaintService.getComplaintDocById.mockResolvedValue({
      status: 'open',
      messages: [{ _id: messageId, user_id: student._id }]
    });
    const next = jest.fn();

    await updateAMessageInComplaint(
      mockReq({
        user: admin,
        params: { ticketId, messageId },
        body: { messages: [{ message: 'updated' }] }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 409 });
    expect(ComplaintService.updateComplaintRaw).not.toHaveBeenCalled();
  });
});

describe('deleteAMessageInComplaint', () => {
  it('pulls the message when the caller owns it and responds 200', async () => {
    ComplaintService.getComplaintDocById.mockResolvedValue({
      status: 'open',
      messages: [{ _id: messageId, user_id: admin._id }]
    });
    ComplaintService.pullMessageById.mockResolvedValue(undefined);
    const res = mockRes();

    await deleteAMessageInComplaint(
      mockReq({ user: admin, params: { ticketId, messageId } }),
      res,
      jest.fn()
    );

    expect(ComplaintService.pullMessageById).toHaveBeenCalledWith(
      ticketId,
      messageId
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });
});

describe('deleteComplaint', () => {
  it('deletes the ticket and responds 200', async () => {
    ComplaintService.getComplaintDocById.mockResolvedValue({
      _id: ticketId,
      requester_id: student._id
    });
    ComplaintService.deleteComplaintById.mockResolvedValue(undefined);
    const res = mockRes();

    await deleteComplaint(mockReq({ params: { ticketId } }), res, jest.fn());

    expect(ComplaintService.deleteComplaintById).toHaveBeenCalledWith(ticketId);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });
});

describe('postMessageInTicket', () => {
  it('appends a message, saves the ticket and responds 201 with the refreshed ticket', async () => {
    const ticketDoc = {
      status: 'open',
      requester_id: {
        _id: admin._id,
        toString: () => admin._id.toString()
      },
      messages: [],
      _id: { toString: () => ticketId },
      title: 'x',
      save: jest.fn().mockResolvedValue(undefined)
    };
    ComplaintService.getComplaintDocByIdWithRequester.mockResolvedValue(
      ticketDoc
    );
    const refreshed = {
      _id: ticketId,
      messages: [{ message: 'New message' }],
      requester_id: { firstname: 'S', lastname: 'T', email: 's@t.co' }
    };
    ComplaintService.getComplaintByIdWithMessages.mockResolvedValue(refreshed);
    const res = mockRes();

    await postMessageInTicket(
      mockReq({
        user: admin,
        params: { ticketId, studentId: student._id },
        body: { message: validMessage }
      }),
      res,
      jest.fn()
    );

    expect(ticketDoc.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: refreshed });
  });

  it('forwards a 404 ErrorResponse to next() when the ticket does not exist', async () => {
    ComplaintService.getComplaintDocByIdWithRequester.mockResolvedValue(null);
    const next = jest.fn();

    await postMessageInTicket(
      mockReq({
        user: admin,
        params: { ticketId, studentId: student._id },
        body: { message: '{}' }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
  });

  it('forwards a 403 when the ticket is already resolved', async () => {
    ComplaintService.getComplaintDocByIdWithRequester.mockResolvedValue({
      status: 'resolved'
    });
    const next = jest.fn();

    await postMessageInTicket(
      mockReq({
        user: admin,
        params: { ticketId, studentId: student._id },
        body: { message: validMessage }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
  });

  it('forwards a 400 when the message JSON is malformed', async () => {
    ComplaintService.getComplaintDocByIdWithRequester.mockResolvedValue({
      status: 'open',
      messages: []
    });
    const next = jest.fn();

    await postMessageInTicket(
      mockReq({
        user: admin,
        params: { ticketId, studentId: student._id },
        body: { message: 'not-json{' }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
  });

  it('forwards a 403 when a student posts to a ticket they do not own', async () => {
    ComplaintService.getComplaintDocByIdWithRequester.mockResolvedValue({
      status: 'open',
      requester_id: { _id: { toString: () => 'someone-else' } },
      messages: []
    });
    const next = jest.fn();

    await postMessageInTicket(
      mockReq({
        user: student,
        params: { ticketId, studentId: student._id },
        body: { message: validMessage }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
  });

  it('forwards a 423 when two uploaded files share the same extension', async () => {
    ComplaintService.getComplaintDocByIdWithRequester.mockResolvedValue({
      status: 'open',
      requester_id: { _id: { toString: () => admin._id.toString() } },
      messages: [],
      save: jest.fn()
    });
    const next = jest.fn();

    await postMessageInTicket(
      mockReq({
        user: admin,
        params: { ticketId, studentId: student._id },
        body: { message: validMessage },
        files: [
          {
            key: `${student._id}/${ticketId}/a.pdf`,
            mimetype: 'application/pdf'
          },
          {
            key: `${student._id}/${ticketId}/b.pdf`,
            mimetype: 'application/pdf'
          }
        ]
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 423 });
  });

  it('student branch: appends file, informs managers, responds 201', async () => {
    const ticketDoc = {
      status: 'open',
      requester_id: {
        _id: { toString: () => student._id.toString() }
      },
      messages: [],
      _id: { toString: () => ticketId },
      title: 'x',
      save: jest.fn().mockResolvedValue(undefined)
    };
    ComplaintService.getComplaintDocByIdWithRequester.mockResolvedValue(
      ticketDoc
    );
    ComplaintService.getComplaintByIdWithMessages.mockResolvedValue({
      _id: ticketId,
      requester_id: { firstname: 'S', lastname: 'T', email: 's@t.co' }
    });
    StudentService.getStudentByIdWithTeam.mockResolvedValue({
      firstname: 'S',
      lastname: 'T',
      archiv: false
    });
    PermissionService.getManagers.mockResolvedValue([
      {
        user_id: {
          firstname: 'M',
          lastname: 'gr',
          email: 'm@g.co',
          archiv: false
        }
      }
    ]);
    const res = mockRes();

    await postMessageInTicket(
      mockReq({
        user: student,
        params: { ticketId, studentId: student._id },
        body: { message: validMessage },
        files: [
          {
            key: `${student._id}/${ticketId}/a.pdf`,
            mimetype: 'application/pdf'
          }
        ]
      }),
      res,
      jest.fn()
    );

    expect(ticketDoc.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(
      emailComplaints.newCustomerCenterTicketMessageEmail
    ).toHaveBeenCalled();
  });
});

describe('getMessageFileInTicket', () => {
  const fileParams = {
    ticketId,
    studentId: student._id.toString(),
    fileKey: 'file.pdf'
  };

  it('cache miss: fetches from S3, caches, and streams the file', async () => {
    asMock(ten_minutes_cache.get).mockReturnValue(undefined);
    asMock(ten_minutes_cache.set).mockReturnValue(true);
    asMock(getS3Object).mockResolvedValue(Buffer.from('content'));
    const res = mockRes();
    res.attachment = jest.fn();

    await getMessageFileInTicket(
      mockReq({ params: fileParams }),
      res,
      jest.fn()
    );

    expect(getS3Object).toHaveBeenCalled();
    expect(ten_minutes_cache.set).toHaveBeenCalled();
    expect(res.attachment).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
  });

  it('cache hit: streams the cached value without touching S3', async () => {
    asMock(ten_minutes_cache.get).mockReturnValue(Buffer.from('cached'));
    const res = mockRes();
    res.attachment = jest.fn();

    await getMessageFileInTicket(
      mockReq({ params: fileParams }),
      res,
      jest.fn()
    );

    expect(getS3Object).not.toHaveBeenCalled();
    expect(res.attachment).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledWith(expect.any(Buffer));
  });
});

describe('createComplaint manager fan-out', () => {
  it('emails every non-archived manager after responding 201', async () => {
    const created = { _id: 'new1', title: 'broken', description: 'd' };
    ComplaintService.createComplaint.mockResolvedValue(created);
    PermissionService.getManagers.mockResolvedValue([
      {
        user_id: {
          firstname: 'M',
          lastname: 'g',
          email: 'm@g.co',
          archiv: false
        }
      }
    ]);
    const res = mockRes();

    await createComplaint(
      mockReq({
        user: { ...admin, archiv: false },
        body: { ticket: { title: 'broken', description: 'd' } }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(emailComplaints.newCustomerCenterTicketEmail).toHaveBeenCalledTimes(
      1
    );
    expect(
      emailComplaints.newCustomerCenterTicketSubmitConfirmationEmail
    ).toHaveBeenCalledTimes(1);
  });
});

describe('updateComplaint resolved cleanup', () => {
  it('runs garbage collection + reminder email when status -> resolved', async () => {
    const updated = {
      _id: ticketId,
      status: 'resolved',
      requester_id: {
        firstname: 'S',
        lastname: 'T',
        email: 's@t.co',
        archiv: false
      }
    };
    ComplaintService.updateComplaintById.mockResolvedValue(updated);
    asMock(threadS3GarbageCollector).mockResolvedValue(undefined);
    const res = mockRes();

    await updateComplaint(
      mockReq({
        user: admin,
        params: { ticketId },
        body: { status: 'resolved' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(threadS3GarbageCollector).toHaveBeenCalledWith(
      expect.anything(),
      'Complaint',
      'requester_id',
      ticketId
    );
    expect(
      emailComplaints.complaintResolvedRequesterReminderEmail
    ).toHaveBeenCalledTimes(1);
  });

  it('swallows a garbage-collector failure (still responds 200)', async () => {
    const updated = {
      _id: ticketId,
      status: 'resolved',
      requester_id: {
        firstname: 'S',
        lastname: 'T',
        email: 's@t.co',
        archiv: true
      }
    };
    ComplaintService.updateComplaintById.mockResolvedValue(updated);
    asMock(threadS3GarbageCollector).mockRejectedValueOnce(
      new Error('s3 fail')
    );
    const res = mockRes();

    await updateComplaint(
      mockReq({
        user: admin,
        params: { ticketId },
        body: { status: 'resolved' }
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('updateAMessageInComplaint error branches', () => {
  it('404 when the ticket does not exist', async () => {
    ComplaintService.getComplaintDocById.mockResolvedValue(null);
    const next = jest.fn();

    await updateAMessageInComplaint(
      mockReq({ user: admin, params: { ticketId, messageId }, body: {} }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
  });

  it('423 when the ticket is closed', async () => {
    ComplaintService.getComplaintDocById.mockResolvedValue({
      status: 'closed',
      messages: []
    });
    const next = jest.fn();

    await updateAMessageInComplaint(
      mockReq({ user: admin, params: { ticketId, messageId }, body: {} }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 423 });
  });

  it('404 when the message id is not in the ticket', async () => {
    ComplaintService.getComplaintDocById.mockResolvedValue({
      status: 'open',
      messages: [{ _id: 'other', user_id: admin._id }]
    });
    const next = jest.fn();

    await updateAMessageInComplaint(
      mockReq({ user: admin, params: { ticketId, messageId }, body: {} }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
  });
});

describe('deleteAMessageInComplaint error branches', () => {
  it('404 when the ticket does not exist', async () => {
    ComplaintService.getComplaintDocById.mockResolvedValue(null);
    const next = jest.fn();

    await deleteAMessageInComplaint(
      mockReq({ user: admin, params: { ticketId, messageId } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
  });

  it('423 when the ticket is resolved', async () => {
    ComplaintService.getComplaintDocById.mockResolvedValue({
      status: 'resolved',
      messages: []
    });
    const next = jest.fn();

    await deleteAMessageInComplaint(
      mockReq({ user: admin, params: { ticketId, messageId } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 423 });
  });

  it('404 when the message id is not present', async () => {
    ComplaintService.getComplaintDocById.mockResolvedValue({
      status: 'open',
      messages: [{ _id: 'other', user_id: admin._id }]
    });
    const next = jest.fn();

    await deleteAMessageInComplaint(
      mockReq({ user: admin, params: { ticketId, messageId } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
  });

  it('409 when the message belongs to another user', async () => {
    ComplaintService.getComplaintDocById.mockResolvedValue({
      status: 'open',
      messages: [{ _id: messageId, user_id: student._id }]
    });
    const next = jest.fn();

    await deleteAMessageInComplaint(
      mockReq({ user: admin, params: { ticketId, messageId } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 409 });
  });
});
