// Controller UNIT test for controllers/tickets.
//
// The handlers are plain (req, res, next) functions (wrapped by asyncHandler), so
// we call them DIRECTLY with fake req/res/next and a MOCKED service layer. No
// route, no middleware, no supertest, no database. We assert ONLY the
// controller's own responsibilities: what it pulls off req, the args it forwards
// to TicketService, the status + body it writes to res, and that it forwards a
// service error to next(). Route + middleware wiring and the real persistence
// path are covered by __tests__/integration/tickets.test.js.

jest.mock('../../services/tickets');
jest.mock('../../services/programs');
jest.mock('../../services/students');
// createTicket / updateTicket fire emails as a fire-and-forget side effect AFTER
// responding; mock them so no real mail is attempted and the after-response work
// resolves quietly.
jest.mock('../../services/email', () => ({
  ...jest.requireActual('../../services/email'),
  TicketCreatedAgentEmail: jest.fn(),
  TicketResolvedRequesterReminderEmail: jest.fn()
}));

import TicketServiceModule from '../../services/tickets';
import ProgramServiceModule from '../../services/programs';
import StudentServiceModule from '../../services/students';
import TicketsController from '../../controllers/tickets';
import { mockReq, mockRes } from '../helpers/httpMocks';
import { admin, student } from '../mock/user';

// Auto-mocked module methods expose jest.fn()s at runtime, but TS still sees
// the real signatures. Re-type as a bag of jest.Mock methods so the per-test
// `.mockResolvedValue()/.mockRejectedValue()` calls type-check.
type MockedModule = Record<string, jest.Mock>;
const TicketService = TicketServiceModule as unknown as MockedModule;
const ProgramService = ProgramServiceModule as unknown as MockedModule;
const StudentService = StudentServiceModule as unknown as MockedModule;

// The controller module uses `export =`, so its members are destructured off
// the default-imported object; the handlers themselves are asyncHandler-wrapped
// (req, res) functions, but tests call them with an extra `next` arg for the
// forward-to-next() cases, so re-type each as a variadic handler.
type ControllerHandler = (...args: unknown[]) => Promise<unknown>;
const {
  getTickets,
  getTicketsOverview,
  createTicket,
  updateTicket,
  deleteTicket
} = TicketsController as unknown as Record<string, ControllerHandler>;

const adminId = admin._id.toString();

beforeEach(() => {
  jest.clearAllMocks();
  // Sensible defaults for the fire-and-forget createTicket follow-up reads so
  // the post-response code resolves without throwing.
  ProgramService.getProgramById.mockResolvedValue({});
  StudentService.getStudentById.mockResolvedValue({ agents: [] });
});

describe('getTickets', () => {
  it('builds the query from req.query and forwards the role-based populate flag', async () => {
    const tickets = [{ _id: 't1' }];
    TicketService.getTickets.mockResolvedValue(tickets);
    const req = mockReq({
      user: admin,
      query: { type: 'program', status: 'open' }
    });
    const res = mockRes();

    await getTickets(req, res, jest.fn());

    const [query, options] = TicketService.getTickets.mock.calls[0];
    expect(query).toEqual({ type: 'program', status: 'open' });
    // admin is a TaiGer role -> populateRequester is true.
    expect(options).toEqual({ populateRequester: true });
    expect(res.send).toHaveBeenCalledWith({ success: true, data: tickets });
  });

  it('omits absent filters and sets populateRequester false for a student', async () => {
    TicketService.getTickets.mockResolvedValue([]);
    const req = mockReq({ user: student, query: { program_id: 'p9' } });

    await getTickets(req, mockRes(), jest.fn());

    const [query, options] = TicketService.getTickets.mock.calls[0];
    expect(query).toEqual({ program_id: 'p9' });
    expect(options).toEqual({ populateRequester: false });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    TicketService.getTickets.mockRejectedValue(err);
    const next = jest.fn();

    await getTickets(mockReq({ user: admin }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('getTicketsOverview', () => {
  it('forwards req.query to the service and sends the paginated envelope', async () => {
    TicketService.getTicketsOverview.mockResolvedValue({
      tickets: [{ _id: 't1' }],
      total: 5,
      page: 2,
      limit: 10
    });
    const req = mockReq({
      user: admin,
      query: { page: '2', limit: '10', search: 'mit', type: 'program' }
    });
    const res = mockRes();

    await getTicketsOverview(req, res, jest.fn());

    expect(TicketService.getTicketsOverview).toHaveBeenCalledWith(req.query);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: [{ _id: 't1' }],
      total: 5,
      page: 2,
      limit: 10
    });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('agg failed');
    TicketService.getTicketsOverview.mockRejectedValue(err);
    const next = jest.fn();

    await getTicketsOverview(
      mockReq({ user: admin, query: {} }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('createTicket', () => {
  it('stamps requester_id from req.user and responds 201 with the created ticket', async () => {
    const created = { _id: 't2', description: 'help' };
    TicketService.createTicket.mockResolvedValue(created);
    const req = mockReq({
      user: admin,
      body: { description: 'help', program_id: 'p1' }
    });
    const res = mockRes();

    await createTicket(req, res, jest.fn());

    const [payload] = TicketService.createTicket.mock.calls[0];
    expect(payload).toMatchObject({
      description: 'help',
      program_id: 'p1',
      requester_id: adminId
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: created });
  });

  it('forwards a service error to next() when creation fails', async () => {
    const err = new Error('insert failed');
    TicketService.createTicket.mockRejectedValue(err);
    const next = jest.fn();

    await createTicket(
      mockReq({ user: admin, body: { description: 'x' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('updateTicket', () => {
  it('forwards id + fields (with an updatedAt Date) and responds 200', async () => {
    const updated = { _id: 't1', description: 'new' };
    TicketService.updateTicketById.mockResolvedValue(updated);
    const req = mockReq({
      user: admin,
      params: { ticket_id: 't1' },
      body: { description: 'new' }
    });
    const res = mockRes();

    await updateTicket(req, res, jest.fn());

    const [id, fields] = TicketService.updateTicketById.mock.calls[0];
    expect(id).toBe('t1');
    expect(fields.description).toBe('new');
    expect(fields.updatedAt).toBeInstanceOf(Date);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: updated });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('update failed');
    TicketService.updateTicketById.mockRejectedValue(err);
    const next = jest.fn();

    await updateTicket(
      mockReq({ user: admin, params: { ticket_id: 't1' }, body: {} }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('deleteTicket', () => {
  it('deletes via the service and responds 200 with success', async () => {
    TicketService.deleteTicketById.mockResolvedValue({});
    const req = mockReq({ params: { ticket_id: 't9' } });
    const res = mockRes();

    await deleteTicket(req, res, jest.fn());

    expect(TicketService.deleteTicketById).toHaveBeenCalledWith('t9');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('delete failed');
    TicketService.deleteTicketById.mockRejectedValue(err);
    const next = jest.fn();

    await deleteTicket(
      mockReq({ params: { ticket_id: 't9' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});
