// Controller UNIT test for controllers/program_requirements.
//
// The handlers are plain (req, res, next) functions, so we call them DIRECTLY
// with fake req/res/next and ProgramRequirementService mocked. We assert ONLY
// the controller's own work: the args it forwards to the service, the status +
// body it writes, the field-shaping it does on create/update, and that it
// forwards a service error to next(). No route, no middleware, no DB. The real
// persistence is covered against an in-memory DB in
// __tests__/integration/program_requirements.test.js.

jest.mock('../../services/programRequirements');

const ProgramRequirementService = require('../../services/programRequirements');
const {
  getDistinctProgramsAndKeywordSets,
  getProgramRequirements,
  getProgramRequirement,
  createProgramRequirement,
  updateProgramRequirement,
  deleteProgramRequirement
} = require('../../controllers/program_requirements');
const { mockReq, mockRes } = require('../helpers/httpMocks');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getDistinctProgramsAndKeywordSets', () => {
  it('responds 200 wrapping the distinct programs and keyword sets', async () => {
    ProgramRequirementService.getDistinctProgramsAndKeywordSets.mockResolvedValue(
      { distinctPrograms: [{ school: 'MIT' }], keywordsets: [{ _id: 'k1' }] }
    );
    const res = mockRes();

    await getDistinctProgramsAndKeywordSets(mockReq(), res, jest.fn());

    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: {
        distinctPrograms: [{ school: 'MIT' }],
        keywordsets: [{ _id: 'k1' }]
      }
    });
  });

  it('rethrows a service error (caught by asyncHandler -> next)', async () => {
    const err = new Error('db down');
    ProgramRequirementService.getDistinctProgramsAndKeywordSets.mockRejectedValue(
      err
    );

    await expect(
      getDistinctProgramsAndKeywordSets(mockReq(), mockRes(), jest.fn())
    ).rejects.toThrow('db down');
  });
});

describe('getProgramRequirements', () => {
  it('responds 200 with the list from the service', async () => {
    const list = [{ _id: 'r1' }, { _id: 'r2' }];
    ProgramRequirementService.getProgramRequirements.mockResolvedValue(list);
    const res = mockRes();

    await getProgramRequirements(mockReq(), res, jest.fn());

    expect(res.send).toHaveBeenCalledWith({ success: true, data: list });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('boom');
    ProgramRequirementService.getProgramRequirements.mockRejectedValue(err);
    const next = jest.fn();

    await getProgramRequirements(mockReq(), mockRes(), next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('getProgramRequirement', () => {
  it('responds 200 bundling the requirement with distinct programs/keywords', async () => {
    const requirement = { _id: 'r1', attributes: ['ELEC-ENG'] };
    ProgramRequirementService.getDistinctProgramsAndKeywordSets.mockResolvedValue(
      { distinctPrograms: [{ school: 'MIT' }], keywordsets: [{ _id: 'k1' }] }
    );
    ProgramRequirementService.getProgramRequirementById.mockResolvedValue(
      requirement
    );
    const req = mockReq({ params: { requirementId: 'r1' } });
    const res = mockRes();

    await getProgramRequirement(req, res, jest.fn());

    expect(
      ProgramRequirementService.getProgramRequirementById
    ).toHaveBeenCalledWith('r1');
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: {
        requirement,
        distinctPrograms: [{ school: 'MIT' }],
        keywordsets: [{ _id: 'k1' }]
      }
    });
  });

  it('forwards a 404 ErrorResponse to next() when the requirement is missing', async () => {
    ProgramRequirementService.getDistinctProgramsAndKeywordSets.mockResolvedValue(
      { distinctPrograms: [], keywordsets: [] }
    );
    ProgramRequirementService.getProgramRequirementById.mockResolvedValue(null);
    const next = jest.fn();

    await getProgramRequirement(
      mockReq({ params: { requirementId: 'missing' } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
  });
});

describe('createProgramRequirement', () => {
  const baseBody = {
    program: { school: 'MIT', program_name: 'CS', degree: 'Master' },
    program_categories: [
      {
        program_category: 'core',
        keywordSets: [{ _id: 'k1' }, { _id: 'k2' }],
        maxScore: 5
      }
    ]
  };

  it('responds 201 mapping keywordSets to ids and attaching matched programIds', async () => {
    ProgramRequirementService.findProgramsBySchoolNameDegree.mockResolvedValue([
      { _id: 'prog-1' }
    ]);
    ProgramRequirementService.getProgramRequirementsByProgramIds.mockResolvedValue(
      []
    );
    const created = { _id: 'req-new' };
    ProgramRequirementService.createProgramRequirement.mockResolvedValue(
      created
    );
    const res = mockRes();

    await createProgramRequirement(
      mockReq({ body: { ...baseBody } }),
      res,
      jest.fn()
    );

    expect(
      ProgramRequirementService.findProgramsBySchoolNameDegree
    ).toHaveBeenCalledWith({
      school: 'MIT',
      program_name: 'CS',
      degree: 'Master'
    });
    const payload =
      ProgramRequirementService.createProgramRequirement.mock.calls[0][0];
    expect(payload.programId).toEqual(['prog-1']);
    expect(payload.program_categories[0].keywordSets).toEqual(['k1', 'k2']);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: created });
  });

  it('forwards a 423 ErrorResponse to next() when an analysis already exists', async () => {
    ProgramRequirementService.findProgramsBySchoolNameDegree.mockResolvedValue([
      { _id: 'prog-1' }
    ]);
    ProgramRequirementService.getProgramRequirementsByProgramIds.mockResolvedValue(
      [{ _id: 'existing' }]
    );
    const next = jest.fn();

    await createProgramRequirement(
      mockReq({ body: { ...baseBody } }),
      mockRes(),
      next
    );

    expect(
      ProgramRequirementService.createProgramRequirement
    ).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 423 });
  });
});

describe('updateProgramRequirement', () => {
  it('responds 200, strips program, and computes coursesScore from maxScores', async () => {
    const updated = { _id: 'r1', admissionDescription: 'modified' };
    ProgramRequirementService.updateProgramRequirementById.mockResolvedValue(
      updated
    );
    const req = mockReq({
      params: { requirementId: 'r1' },
      body: {
        admissionDescription: 'modified',
        program: { school: 'MIT' },
        program_categories: [{ maxScore: 3 }, { maxScore: 4 }]
      }
    });
    const res = mockRes();

    await updateProgramRequirement(req, res, jest.fn());

    const [id, fields] =
      ProgramRequirementService.updateProgramRequirementById.mock.calls[0];
    expect(id).toBe('r1');
    expect(fields.program).toBeUndefined();
    expect(fields.coursesScore).toBe(7);
    expect(fields.updatedAt).toBeInstanceOf(Date);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: updated });
  });

  it('forwards a 404 ErrorResponse to next() when nothing was updated', async () => {
    ProgramRequirementService.updateProgramRequirementById.mockResolvedValue(
      null
    );
    const next = jest.fn();

    await updateProgramRequirement(
      mockReq({ params: { requirementId: 'missing' }, body: {} }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
  });
});

describe('deleteProgramRequirement', () => {
  it('responds 200 after delegating the delete to the service', async () => {
    ProgramRequirementService.deleteProgramRequirementById.mockResolvedValue(
      {}
    );
    const res = mockRes();

    await deleteProgramRequirement(
      mockReq({ params: { requirementId: 'r1' } }),
      res,
      jest.fn()
    );

    expect(
      ProgramRequirementService.deleteProgramRequirementById
    ).toHaveBeenCalledWith('r1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });
});
