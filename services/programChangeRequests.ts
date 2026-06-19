import ProgramChangeRequestDAO from '../dao/programChangeRequest.dao';

/**
 * ProgramChangeRequestService — business layer for program change requests.
 * Delegates data access to the DAO (controller -> service -> dao).
 */
const ProgramChangeRequestService = {
  getOpenChangeRequestsByProgramId(programId: string) {
    return ProgramChangeRequestDAO.getOpenChangeRequestsByProgramId(programId);
  },

  upsertChangeRequest(
    programId: string,
    requestedBy: string,
    changes: Record<string, unknown>
  ) {
    return ProgramChangeRequestDAO.upsertChangeRequest(
      programId,
      requestedBy,
      changes
    );
  },

  getChangeRequestById(requestId: string) {
    return ProgramChangeRequestDAO.getChangeRequestById(requestId);
  },

  updateChangeRequestById(requestId: string, payload: Record<string, unknown>) {
    return ProgramChangeRequestDAO.updateChangeRequestById(requestId, payload);
  }
};

export = ProgramChangeRequestService;
