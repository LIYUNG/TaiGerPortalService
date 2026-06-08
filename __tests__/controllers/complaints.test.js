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

const ComplaintService = require('../../services/complaints');
const PermissionService = require('../../services/permissions');
const StudentService = require('../../services/students');
const {
  getComplaints,
  getComplaint,
  createComplaint,
  updateComplaint,
  postMessageInTicket,
  updateAMessageInComplaint,
  deleteAMessageInComplaint,
  deleteComplaint
} = require('../../controllers/complaints');
const { mockReq, mockRes } = require('../helpers/httpMocks');
const { admin, student } = require('../mock/user');

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
});
