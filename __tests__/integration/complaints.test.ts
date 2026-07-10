// Integration test for the complaints (customer-center) routes — HTTP boundary
// down to the service, with the DAO layer MOCKED (no database, in-memory or
// otherwise):
//   supertest -> real router -> real middleware -> real controllers/complaints
//   -> real ComplaintService -> MOCKED ComplaintDAO.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return. The actual DB
// query construction is covered by the DAO unit tests. Fully deterministic —
// no engine flake.

import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';

import { protect } from '../../middlewares/auth';
import { TENANT_ID } from '../fixtures/constants';
import { student } from '../mock/user';
import {
  tickets,
  ticket,
  ticketNew,
  ticketWithMessage
} from '../mock/complaintTickets';

// Auto-mocked modules expose jest.fn()s at runtime, but TS still sees the real
// signatures. `asMock` casts a binding to jest.Mock so the per-test
// `.mockImplementation()/.mockResolvedValue()` calls type-check while allowing
// partial (non-Mongoose) return shapes.
const asMock = (fn: unknown) => fn as jest.Mock;

// The standard passthrough middleware mocks come from one shared helper (see
// __tests__/helpers/middlewareMocks). require() keeps them compatible with
// ts-jest's jest.mock hoisting.
jest.mock('../../middlewares/tenantMiddleware', () =>
  require('../helpers/middlewareMocks').tenantMiddlewareMock()
);
jest.mock('../../middlewares/decryptCookieMiddleware', () =>
  require('../helpers/middlewareMocks').decryptCookieMiddlewareMock()
);
jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () =>
  require('../helpers/middlewareMocks').innerTaigerMultitenantFilterMock()
);
jest.mock('../../middlewares/permission-filter', () =>
  require('../helpers/middlewareMocks').permissionFilterMock()
);
jest.mock('../../middlewares/multitenant-filter', () => {
  const mw = require('../helpers/middlewareMocks');
  return mw.multitenantFilterMock({
    complaintTicketMultitenant_filter: mw.passthroughFn()
  });
});
jest.mock('../../middlewares/auth', () => {
  const mw = require('../helpers/middlewareMocks');
  return mw.authMock({ localAuth: mw.passthroughFn() });
});

// Write paths fan out to email/S3 (fire-and-forget after the response is sent).
// Stub the senders + the S3 garbage collector so no SMTP/S3 connection is
// opened. The create/update/persist path under test stays real.
jest.mock('../../services/email/complaints', () => ({
  newCustomerCenterTicketEmail: jest.fn(),
  newCustomerCenterTicketSubmitConfirmationEmail: jest.fn(),
  complaintResolvedRequesterReminderEmail: jest.fn(),
  newCustomerCenterTicketMessageEmail: jest.fn()
}));

jest.mock('../../utils/utils_function', () => ({
  ...jest.requireActual('../../utils/utils_function'),
  threadS3GarbageCollector: jest.fn()
}));

jest.mock('../../utils/modelHelper/versionControl', () => ({
  ...jest.requireActual('../../utils/modelHelper/versionControl'),
  emptyS3Directory: jest.fn()
}));

// The data boundary: mock the DAOs the complaint controller delegates to. The
// permission/student DAOs are only touched on the post-response email fan-out.
jest.mock('../../dao/complaint.dao');
jest.mock('../../dao/permission.dao');
jest.mock('../../dao/student.dao');

import ComplaintDAOModule from '../../dao/complaint.dao';
import PermissionDAOModule from '../../dao/permission.dao';
import StudentDAOModule from '../../dao/student.dao';
import { app } from '../../app';

// The DAOs are auto-mocked above; re-type each as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockImplementation()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const ComplaintDAO = ComplaintDAOModule as unknown as MockedDAO;
const PermissionDAO = PermissionDAOModule as unknown as MockedDAO;
const StudentDAO = StudentDAOModule as unknown as MockedDAO;

const requestWithSupertest = request(app);
const studentId = student._id.toString();

beforeEach(() => {
  jest.clearAllMocks();
  asMock(protect).mockImplementation(
    async (req: Request, res: Response, next: NextFunction) => {
      req.user = student;
      next();
    }
  );
  // Defaults for the fire-and-forget email fan-out (post-response).
  PermissionDAO.getManagers.mockResolvedValue([]);
  StudentDAO.getStudentByIdWithTeam.mockResolvedValue({
    firstname: 'F',
    lastname: 'L',
    archiv: false
  });
});

describe('GET /api/complaints', () => {
  it('returns the requesting student tickets from the DAO', async () => {
    ComplaintDAO.getComplaintsByRequester.mockResolvedValue(tickets);

    const resp = await requestWithSupertest
      .get('/api/complaints')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(Array.isArray(resp.body.data)).toBe(true);
    expect(resp.body.data.length).toBe(tickets.length);
    expect(ComplaintDAO.getComplaintsByRequester).toHaveBeenCalledWith(
      student._id
    );
  });
});

describe('POST /api/complaints', () => {
  it('creates a ticket stamped with the requester id', async () => {
    ComplaintDAO.createComplaint.mockImplementation(
      async (t: Record<string, unknown>) => ({
        _id: ticketNew._id,
        ...t
      })
    );

    const resp = await requestWithSupertest
      .post('/api/complaints')
      .set('tenantId', TENANT_ID)
      .send({ ticket: { ...ticketNew } });

    expect(resp.status).toBe(201);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.requester_id.toString()).toBe(studentId);
    expect(ComplaintDAO.createComplaint).toHaveBeenCalledWith(
      expect.objectContaining({ requester_id: studentId })
    );
  });
});

describe('GET /api/complaints/:ticketId', () => {
  it('returns the ticket from the DAO, queried by id', async () => {
    ComplaintDAO.getComplaintByIdPopulated.mockResolvedValue(ticket);

    const resp = await requestWithSupertest
      .get(`/api/complaints/${ticket._id.toString()}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data._id.toString()).toBe(ticket._id.toString());
    expect(ComplaintDAO.getComplaintByIdPopulated).toHaveBeenCalledWith(
      ticket._id.toString()
    );
  });

  it('404s when the DAO finds no ticket', async () => {
    ComplaintDAO.getComplaintByIdPopulated.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .get(`/api/complaints/${ticket._id.toString()}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(404);
  });
});

describe('POST /api/complaints/new-message/:ticketId/:studentId', () => {
  it('appends a message that is visible on the refreshed ticket', async () => {
    // The handler loads a live doc (mutates messages + .save()), then re-reads
    // the populated ticket for the response.
    const messages: Record<string, unknown>[] = [];
    const liveTicket = {
      _id: ticket._id,
      title: ticket.title,
      status: 'open',
      requester_id: { _id: student._id },
      messages,
      save: jest.fn().mockResolvedValue(true)
    };
    ComplaintDAO.getComplaintDocByIdWithRequester.mockResolvedValue(liveTicket);
    ComplaintDAO.getComplaintByIdWithMessages.mockImplementation(async () => ({
      _id: ticket._id,
      title: ticket.title,
      requester_id: {
        _id: student._id,
        firstname: 'F',
        lastname: 'L',
        email: 'f@l.com'
      },
      messages: liveTicket.messages
    }));

    const resp = await requestWithSupertest
      .post(`/api/complaints/new-message/${ticket._id.toString()}/${studentId}`)
      .set('tenantId', TENANT_ID)
      .send({
        message:
          '{"time":1709677608094,"blocks":[{"id":"9ntXJB6f3L","type":"paragraph","data":{"text":"New message"}}],"version":"2.29.0"}'
      });

    expect(resp.status).toBe(201);
    expect(liveTicket.save).toHaveBeenCalled();
    expect(resp.body.data.messages[0].message).toContain('New message');
    expect(ComplaintDAO.getComplaintDocByIdWithRequester).toHaveBeenCalledWith(
      ticket._id.toString()
    );
  });
});

describe('PUT /api/complaints/:ticketId/:messageId', () => {
  it('updates an existing message in a ticket', async () => {
    const messageId = ticketWithMessage.messages[0]._id.toString();
    // getComplaintDocById returns a live doc with the owned message.
    ComplaintDAO.getComplaintDocById.mockResolvedValue({
      _id: ticketWithMessage._id,
      status: 'open',
      messages: [{ _id: messageId, user_id: student._id }]
    });
    ComplaintDAO.updateComplaintRaw.mockResolvedValue({});

    const resp = await requestWithSupertest
      .put(`/api/complaints/${ticketWithMessage._id.toString()}/${messageId}`)
      .set('tenantId', TENANT_ID)
      .send({
        message:
          '{"time":1709677608094,"blocks":[{"id":"9ntXJB6f3L","type":"paragraph","data":{"text":"updated message"}}],"version":"2.29.0"}'
      });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(ComplaintDAO.updateComplaintRaw).toHaveBeenCalledWith(
      ticketWithMessage._id.toString(),
      expect.objectContaining({ message: expect.any(String) })
    );
  });
});

describe('PUT /api/complaints/:ticketId', () => {
  it('persists the updated ticket fields via the DAO', async () => {
    ComplaintDAO.updateComplaintById.mockResolvedValue({
      _id: ticket._id,
      description: 'new information',
      requester_id: { firstname: 'F', lastname: 'L', email: 'f@l.com' }
    });

    const resp = await requestWithSupertest
      .put(`/api/complaints/${ticket._id.toString()}`)
      .set('tenantId', TENANT_ID)
      .send({ description: 'new information' });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.description).toBe('new information');
    expect(ComplaintDAO.updateComplaintById).toHaveBeenCalledWith(
      ticket._id.toString(),
      expect.objectContaining({ description: 'new information' })
    );
  });

  it('404s when the DAO updates no ticket', async () => {
    ComplaintDAO.updateComplaintById.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .put(`/api/complaints/${ticket._id.toString()}`)
      .set('tenantId', TENANT_ID)
      .send({ description: 'new information' });

    expect(resp.status).toBe(404);
  });
});

describe('DELETE /api/complaints/:ticketId', () => {
  it('deletes the ticket via the DAO (after an existence read)', async () => {
    // deleteComplaint first reads the doc (for the requester id used in S3
    // cleanup), then deletes.
    ComplaintDAO.getComplaintDocById.mockResolvedValue({
      _id: ticket._id,
      requester_id: student._id
    });
    ComplaintDAO.deleteComplaintById.mockResolvedValue({ deletedCount: 1 });

    const del = await requestWithSupertest
      .delete(`/api/complaints/${ticket._id.toString()}`)
      .set('tenantId', TENANT_ID);

    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);
    expect(ComplaintDAO.getComplaintDocById).toHaveBeenCalledWith(
      ticket._id.toString()
    );
    expect(ComplaintDAO.deleteComplaintById).toHaveBeenCalledWith(
      ticket._id.toString()
    );
  });
});
