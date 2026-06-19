import ProgramChangeRequestDAO from '../dao/programChangeRequest.dao';
import type { IProgramChangeRequestDAO } from '../dao/programChangeRequest.dao.types';

/**
 * ProgramChangeRequestService — business layer for program change requests.
 * Depends only on the IProgramChangeRequestDAO strategy contract (constructor
 * injection), so the storage engine can be swapped by constructing the service
 * with a different DAO.
 */
export class ProgramChangeRequestService {
  constructor(private readonly dao: IProgramChangeRequestDAO) {}

  getOpenChangeRequestsByProgramId(programId: string) {
    return this.dao.getOpenChangeRequestsByProgramId(programId);
  }

  upsertChangeRequest(
    programId: string,
    requestedBy: string,
    changes: Record<string, unknown>
  ) {
    return this.dao.upsertChangeRequest(programId, requestedBy, changes);
  }

  getChangeRequestById(requestId: string) {
    return this.dao.getChangeRequestById(requestId);
  }

  updateChangeRequestById(requestId: string, payload: Record<string, unknown>) {
    return this.dao.updateChangeRequestById(requestId, payload);
  }
}

// Production instance, wired to the MongoDB strategy.
const programChangeRequestService = new ProgramChangeRequestService(
  ProgramChangeRequestDAO
);

export default programChangeRequestService;
