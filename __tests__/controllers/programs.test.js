// Controller UNIT test for controllers/programs.
//
// The handlers are plain (req, res, next) functions (wrapped by asyncHandler),
// so we call them DIRECTLY with fake req/res/next and the service layer mocked.
// We assert ONLY the controller's own work: the args it forwards to each
// service, the status + body it writes to res, and that it forwards a service
// error to next(). No route, no middleware, no DB. The real
// aggregation/persistence is covered against an in-memory DB in
// __tests__/integration/programs.test.js and the service/dao suites.

jest.mock('../../services/programs');
jest.mock('../../services/applications');
jest.mock('../../services/vs');
jest.mock('../../services/programRequirements');
jest.mock('../../services/tickets');

const ProgramService = require('../../services/programs');
const ApplicationService = require('../../services/applications');
const VCService = require('../../services/vs');
const ProgramRequirementService = require('../../services/programRequirements');
const TicketService = require('../../services/tickets');
const {
  getPrograms,
  getSameProgramStudents,
  getProgram,
  createProgram,
  updateProgram,
  deleteProgram,
  refreshProgram
} = require('../../controllers/programs');
const { mockReq, mockRes } = require('../helpers/httpMocks');
const { admin } = require('../mock/user');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getPrograms', () => {
  it('forwards req.query to the service and echoes its pagination envelope', async () => {
    ProgramService.getProgramsPaginated.mockResolvedValue({
      programs: [{ _id: 'p1' }],
      total: 1,
      page: 1,
      limit: 20
    });
    const query = { page: '1', limit: '20', search: 'mit' };
    const req = mockReq({ query });
    const res = mockRes();

    await getPrograms(req, res, jest.fn());

    expect(ProgramService.getProgramsPaginated).toHaveBeenCalledWith(query);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: [{ _id: 'p1' }],
      total: 1,
      page: 1,
      limit: 20
    });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    ProgramService.getProgramsPaginated.mockRejectedValue(err);
    const next = jest.fn();

    await getPrograms(mockReq({ query: {} }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('getSameProgramStudents', () => {
  it('responds 200 with the de-duplicated students sharing the program', async () => {
    ApplicationService.getDecidedApplicationsByProgramPopulated.mockResolvedValue(
      [
        {
          studentId: { _id: 's1', agents: ['a1'] },
          application_year: '2026',
          closed: 'O',
          admission: 'O'
        }
      ]
    );
    const req = mockReq({ params: { programId: 'prog-1' } });
    const res = mockRes();

    await getSameProgramStudents(req, res, jest.fn());

    expect(
      ApplicationService.getDecidedApplicationsByProgramPopulated
    ).toHaveBeenCalledWith('prog-1');
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: expect.any(Array)
    });
    const body = res.send.mock.calls[0][0];
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ _id: 's1', application_year: '2026' });
  });
});

describe('getProgram', () => {
  it('responds 200 with the program and its version-control entry for staff', async () => {
    const program = { _id: 'prog-1', school: 'MIT' };
    const vc = { docId: 'prog-1', changes: [] };
    ProgramService.getProgramById.mockResolvedValue(program);
    VCService.getVC.mockResolvedValue(vc);
    const req = mockReq({ params: { programId: 'prog-1' }, user: admin });
    const res = mockRes();

    await getProgram(req, res, jest.fn());

    expect(ProgramService.getProgramById).toHaveBeenCalledWith('prog-1');
    expect(VCService.getVC).toHaveBeenCalledWith({
      docId: 'prog-1',
      collectionName: 'Program'
    });
    expect(res.send).toHaveBeenCalledWith({ success: true, data: program, vc });
  });

  it('forwards a 404 ErrorResponse to next() when the program is missing', async () => {
    ProgramService.getProgramById.mockResolvedValue(null);
    const next = jest.fn();

    await getProgram(
      mockReq({ params: { programId: 'missing' }, user: admin }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
  });
});

describe('createProgram', () => {
  it('responds 201 with the created program when no duplicate exists', async () => {
    const created = { _id: 'new', school: 'MIT', program_name: 'CS' };
    ProgramService.getPrograms.mockResolvedValue([]);
    ProgramService.createProgram.mockResolvedValue(created);
    const req = mockReq({
      user: admin,
      body: { school: '  MIT  ', program_name: '  CS  ', degree: 'Master' }
    });
    const res = mockRes();

    await createProgram(req, res, jest.fn());

    // trims and stamps whoupdated before persisting
    expect(ProgramService.createProgram).toHaveBeenCalledWith(
      expect.objectContaining({
        school: 'MIT',
        program_name: 'CS',
        whoupdated: `${admin.firstname} ${admin.lastname}`,
        updatedAt: expect.any(Date)
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: created });
  });

  it('forwards a 403 ErrorResponse to next() when the program already exists', async () => {
    ProgramService.getPrograms.mockResolvedValue([{ _id: 'dup' }]);
    const next = jest.fn();

    await createProgram(
      mockReq({
        user: admin,
        body: { school: 'MIT', program_name: 'CS', degree: 'Master' }
      }),
      mockRes(),
      next
    );

    expect(ProgramService.createProgram).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
  });
});

describe('updateProgram', () => {
  it('updates the program, fans the common fields to siblings, and returns vc', async () => {
    const program = {
      _id: 'prog-1',
      school: 'MIT',
      program_name: 'CS',
      degree: 'Master'
    };
    const vc = { docId: 'prog-1', changes: [{ field: 'ml_required' }] };
    ProgramService.updateProgramOne.mockResolvedValue(program);
    ProgramService.updateManyPrograms.mockResolvedValue({});
    VCService.getVC.mockResolvedValue(vc);
    const req = mockReq({
      user: admin,
      params: { programId: 'prog-1' },
      body: { ml_required: 'yes', semester: 'WS' }
    });
    const res = mockRes();

    await updateProgram(req, res, jest.fn());

    expect(ProgramService.updateProgramOne).toHaveBeenCalledWith(
      { _id: 'prog-1' },
      expect.objectContaining({
        ml_required: 'yes',
        whoupdated: `${admin.firstname} ${admin.lastname}`
      })
    );
    expect(ProgramService.updateManyPrograms).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: program, vc });
  });
});

describe('deleteProgram', () => {
  it('archives the program and cascades when nothing applied to it', async () => {
    ApplicationService.getApplicationsByProgramId.mockResolvedValue([]);
    ProgramService.archiveProgramById.mockResolvedValue({});
    ProgramRequirementService.deleteOneByProgramIds.mockResolvedValue({});
    TicketService.deleteTicketsByProgramId.mockResolvedValue({});
    const req = mockReq({ params: { programId: 'prog-1' } });
    const res = mockRes();

    await deleteProgram(req, res, jest.fn());

    expect(ProgramService.archiveProgramById).toHaveBeenCalledWith('prog-1');
    expect(
      ProgramRequirementService.deleteOneByProgramIds
    ).toHaveBeenCalledWith(['prog-1']);
    expect(TicketService.deleteTicketsByProgramId).toHaveBeenCalledWith(
      'prog-1'
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });

  it('forwards a 403 ErrorResponse to next() when applications still reference it', async () => {
    ApplicationService.getApplicationsByProgramId.mockResolvedValue([
      { studentId: 's1' }
    ]);
    const next = jest.fn();

    await deleteProgram(
      mockReq({ params: { programId: 'prog-1' } }),
      mockRes(),
      next
    );

    expect(ProgramService.archiveProgramById).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
  });
});

describe('refreshProgram', () => {
  it('stamps updatedAt/whoupdated, pushes a vc change, and returns 200', async () => {
    const program = { _id: 'prog-1', school: 'MIT' };
    const vc = { docId: 'prog-1', changes: [{ field: 'none' }] };
    ProgramService.updateProgramById.mockResolvedValue(program);
    VCService.pushChange.mockResolvedValue({});
    VCService.getVC.mockResolvedValue(vc);
    const req = mockReq({ user: admin, params: { programId: 'prog-1' } });
    const res = mockRes();

    await refreshProgram(req, res, jest.fn());

    expect(ProgramService.updateProgramById).toHaveBeenCalledWith(
      'prog-1',
      expect.objectContaining({
        whoupdated: `${admin.firstname} ${admin.lastname}`,
        updatedAt: expect.any(Date)
      })
    );
    expect(VCService.pushChange).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: program, vc });
  });

  it('forwards a 404 ErrorResponse to next() when the program is missing', async () => {
    ProgramService.updateProgramById.mockResolvedValue(null);
    const next = jest.fn();

    await refreshProgram(
      mockReq({ user: admin, params: { programId: 'missing' } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
  });
});
