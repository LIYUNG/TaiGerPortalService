// ProgramChangeRequestService is a set of thin pass-throughs to
// ProgramChangeRequestDAO. This is a UNIT test: the DAO is mocked so no database
// is touched.
jest.mock('../../dao/programChangeRequest.dao');

import ProgramChangeRequestDAO from '../../dao/programChangeRequest.dao';
import ProgramChangeRequestService from '../../services/programChangeRequests';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ProgramChangeRequestService.getOpenChangeRequestsByProgramId (mocked DAO)', () => {
  it('delegates to DAO.getOpenChangeRequestsByProgramId and returns its result', async () => {
    const programId = 'p1';
    const daoResult = [{ _id: 'cr1', status: 'open' }];
    ProgramChangeRequestDAO.getOpenChangeRequestsByProgramId.mockResolvedValue(
      daoResult
    );

    const result =
      await ProgramChangeRequestService.getOpenChangeRequestsByProgramId(
        programId
      );

    expect(
      ProgramChangeRequestDAO.getOpenChangeRequestsByProgramId
    ).toHaveBeenCalledTimes(1);
    expect(
      ProgramChangeRequestDAO.getOpenChangeRequestsByProgramId
    ).toHaveBeenCalledWith(programId);
    expect(result).toBe(daoResult);
  });
});

describe('ProgramChangeRequestService.upsertChangeRequest (mocked DAO)', () => {
  it('delegates to DAO.upsertChangeRequest with programId, requestedBy, changes', async () => {
    const programId = 'p1';
    const requestedBy = 'agent1';
    const changes = { toefl: '100' };
    const daoResult = { _id: 'cr1', program: 'p1' };
    ProgramChangeRequestDAO.upsertChangeRequest.mockResolvedValue(daoResult);

    const result = await ProgramChangeRequestService.upsertChangeRequest(
      programId,
      requestedBy,
      changes
    );

    expect(ProgramChangeRequestDAO.upsertChangeRequest).toHaveBeenCalledTimes(
      1
    );
    expect(ProgramChangeRequestDAO.upsertChangeRequest).toHaveBeenCalledWith(
      programId,
      requestedBy,
      changes
    );
    expect(result).toBe(daoResult);
  });
});

describe('ProgramChangeRequestService.getChangeRequestById (mocked DAO)', () => {
  it('delegates to DAO.getChangeRequestById with requestId and returns its result', async () => {
    const requestId = 'cr1';
    const daoResult = { _id: 'cr1', status: 'open' };
    ProgramChangeRequestDAO.getChangeRequestById.mockResolvedValue(daoResult);

    const result = await ProgramChangeRequestService.getChangeRequestById(
      requestId
    );

    expect(ProgramChangeRequestDAO.getChangeRequestById).toHaveBeenCalledTimes(
      1
    );
    expect(ProgramChangeRequestDAO.getChangeRequestById).toHaveBeenCalledWith(
      requestId
    );
    expect(result).toBe(daoResult);
  });
});

describe('ProgramChangeRequestService.updateChangeRequestById (mocked DAO)', () => {
  it('delegates to DAO.updateChangeRequestById with requestId and payload', async () => {
    const requestId = 'cr1';
    const payload = { status: 'approved' };
    const daoResult = { _id: 'cr1', status: 'approved' };
    ProgramChangeRequestDAO.updateChangeRequestById.mockResolvedValue(
      daoResult
    );

    const result = await ProgramChangeRequestService.updateChangeRequestById(
      requestId,
      payload
    );

    expect(
      ProgramChangeRequestDAO.updateChangeRequestById
    ).toHaveBeenCalledTimes(1);
    expect(
      ProgramChangeRequestDAO.updateChangeRequestById
    ).toHaveBeenCalledWith(requestId, payload);
    expect(result).toBe(daoResult);
  });
});
