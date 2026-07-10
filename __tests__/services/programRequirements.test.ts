// ProgramRequirementService composes the ProgramRequirement / Program /
// KeywordSet DAOs. This is a UNIT test: all DAOs are mocked so no database is
// touched. Most methods are thin pass-throughs;
// getDistinctProgramsAndKeywordSets fans out to two DAOs in parallel and
// composes the result.
jest.mock('../../dao/programRequirement.dao');
jest.mock('../../dao/program.dao');
jest.mock('../../dao/keywordset.dao');

import ProgramRequirementDAOReal from '../../dao/programRequirement.dao';
import ProgramDAOReal from '../../dao/program.dao';
import KeywordSetDAOReal from '../../dao/keywordset.dao';
import ProgramRequirementService from '../../services/programRequirements';

const ProgramRequirementDAO = ProgramRequirementDAOReal as unknown as Record<
  string,
  jest.Mock
>;
const ProgramDAO = ProgramDAOReal as unknown as Record<string, jest.Mock>;
const KeywordSetDAO = KeywordSetDAOReal as unknown as Record<string, jest.Mock>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ProgramRequirementService.getDistinctProgramsAndKeywordSets (mocked DAOs)', () => {
  it('fans out to ProgramDAO + KeywordSetDAO and composes the result', async () => {
    const distinctPrograms = [{ school: 'A', program_name: 'CS' }];
    const keywordsets = [{ _id: 'ks1' }];
    ProgramDAO.getDistinctSchoolProgramDegree.mockResolvedValue(
      distinctPrograms
    );
    KeywordSetDAO.getKeywordSets.mockResolvedValue(keywordsets);

    const result =
      await ProgramRequirementService.getDistinctProgramsAndKeywordSets();

    expect(ProgramDAO.getDistinctSchoolProgramDegree).toHaveBeenCalledTimes(1);
    expect(ProgramDAO.getDistinctSchoolProgramDegree).toHaveBeenCalledWith();
    expect(KeywordSetDAO.getKeywordSets).toHaveBeenCalledTimes(1);
    expect(KeywordSetDAO.getKeywordSets).toHaveBeenCalledWith();
    expect(result).toEqual({ distinctPrograms, keywordsets });
  });
});

describe('ProgramRequirementService.getProgramRequirements (mocked DAO)', () => {
  it('delegates to DAO.getProgramRequirements and returns its result', async () => {
    const daoResult = [{ _id: 'r1' }];
    ProgramRequirementDAO.getProgramRequirements.mockResolvedValue(daoResult);

    const result = await ProgramRequirementService.getProgramRequirements();

    expect(ProgramRequirementDAO.getProgramRequirements).toHaveBeenCalledTimes(
      1
    );
    expect(ProgramRequirementDAO.getProgramRequirements).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });
});

describe('ProgramRequirementService.getProgramRequirementById (mocked DAO)', () => {
  it('delegates to DAO.getProgramRequirementById with requirementId', async () => {
    const requirementId = 'r1';
    const daoResult = { _id: 'r1' };
    ProgramRequirementDAO.getProgramRequirementById.mockResolvedValue(
      daoResult
    );

    const result = await ProgramRequirementService.getProgramRequirementById(
      requirementId
    );

    expect(
      ProgramRequirementDAO.getProgramRequirementById
    ).toHaveBeenCalledTimes(1);
    expect(
      ProgramRequirementDAO.getProgramRequirementById
    ).toHaveBeenCalledWith(requirementId);
    expect(result).toBe(daoResult);
  });
});

describe('ProgramRequirementService.findProgramsBySchoolNameDegree (mocked DAO)', () => {
  it('delegates to ProgramDAO.findProgramsBySchoolNameDegree with program', async () => {
    const program = { school: 'A', program_name: 'CS', degree: 'MS' };
    const daoResult = [{ _id: 'p1' }];
    ProgramDAO.findProgramsBySchoolNameDegree.mockResolvedValue(daoResult);

    const result =
      await ProgramRequirementService.findProgramsBySchoolNameDegree(program);

    expect(ProgramDAO.findProgramsBySchoolNameDegree).toHaveBeenCalledTimes(1);
    expect(ProgramDAO.findProgramsBySchoolNameDegree).toHaveBeenCalledWith(
      program
    );
    expect(result).toBe(daoResult);
  });
});

describe('ProgramRequirementService.getProgramRequirementsByProgramIds (mocked DAO)', () => {
  it('delegates to DAO.getProgramRequirementsByProgramIds with programIds', async () => {
    const programIds = ['p1', 'p2'];
    const daoResult = [{ _id: 'r1' }];
    ProgramRequirementDAO.getProgramRequirementsByProgramIds.mockResolvedValue(
      daoResult
    );

    const result =
      await ProgramRequirementService.getProgramRequirementsByProgramIds(
        programIds
      );

    expect(
      ProgramRequirementDAO.getProgramRequirementsByProgramIds
    ).toHaveBeenCalledTimes(1);
    expect(
      ProgramRequirementDAO.getProgramRequirementsByProgramIds
    ).toHaveBeenCalledWith(programIds);
    expect(result).toBe(daoResult);
  });
});

describe('ProgramRequirementService.createProgramRequirement (mocked DAO)', () => {
  it('delegates to DAO.createProgramRequirement with payload', async () => {
    const payload = { program: 'p1', value: 'x' };
    const daoResult = { _id: 'r1' };
    ProgramRequirementDAO.createProgramRequirement.mockResolvedValue(daoResult);

    const result = await ProgramRequirementService.createProgramRequirement(
      payload as any
    );

    expect(
      ProgramRequirementDAO.createProgramRequirement
    ).toHaveBeenCalledTimes(1);
    expect(ProgramRequirementDAO.createProgramRequirement).toHaveBeenCalledWith(
      payload
    );
    expect(result).toBe(daoResult);
  });
});

describe('ProgramRequirementService.updateProgramRequirementById (mocked DAO)', () => {
  it('delegates to DAO.updateProgramRequirementById with requirementId and fields', async () => {
    const requirementId = 'r1';
    const fields = { value: 'y' };
    const daoResult = { _id: 'r1', value: 'y' };
    ProgramRequirementDAO.updateProgramRequirementById.mockResolvedValue(
      daoResult
    );

    const result = await ProgramRequirementService.updateProgramRequirementById(
      requirementId,
      fields
    );

    expect(
      ProgramRequirementDAO.updateProgramRequirementById
    ).toHaveBeenCalledTimes(1);
    expect(
      ProgramRequirementDAO.updateProgramRequirementById
    ).toHaveBeenCalledWith(requirementId, fields);
    expect(result).toBe(daoResult);
  });
});

describe('ProgramRequirementService.deleteProgramRequirementById (mocked DAO)', () => {
  it('delegates to DAO.deleteProgramRequirementById with requirementId', async () => {
    const requirementId = 'r1';
    const daoResult = { deletedCount: 1 };
    ProgramRequirementDAO.deleteProgramRequirementById.mockResolvedValue(
      daoResult
    );

    const result = await ProgramRequirementService.deleteProgramRequirementById(
      requirementId
    );

    expect(
      ProgramRequirementDAO.deleteProgramRequirementById
    ).toHaveBeenCalledTimes(1);
    expect(
      ProgramRequirementDAO.deleteProgramRequirementById
    ).toHaveBeenCalledWith(requirementId);
    expect(result).toBe(daoResult);
  });
});

describe('ProgramRequirementService.deleteOneByProgramIds (mocked DAO)', () => {
  it('delegates to DAO.deleteOneByProgramIds with programIds', async () => {
    const programIds = ['p1', 'p2'];
    const daoResult = { deletedCount: 1 };
    ProgramRequirementDAO.deleteOneByProgramIds.mockResolvedValue(daoResult);

    const result = await ProgramRequirementService.deleteOneByProgramIds(
      programIds
    );

    expect(ProgramRequirementDAO.deleteOneByProgramIds).toHaveBeenCalledTimes(
      1
    );
    expect(ProgramRequirementDAO.deleteOneByProgramIds).toHaveBeenCalledWith(
      programIds
    );
    expect(result).toBe(daoResult);
  });
});
