const ProgramChangeRequestDAO = require('../dao/programChangeRequest.dao');

/**
 * ProgramChangeRequestService — business layer for program change requests.
 * Delegates data access to the DAO (controller -> service -> dao).
 */
const ProgramChangeRequestService = {
  getOpenChangeRequestsByProgramId(programId) {
    return ProgramChangeRequestDAO.getOpenChangeRequestsByProgramId(programId);
  },

  upsertChangeRequest(programId, requestedBy, changes) {
    return ProgramChangeRequestDAO.upsertChangeRequest(
      programId,
      requestedBy,
      changes
    );
  },

  getChangeRequestById(requestId) {
    return ProgramChangeRequestDAO.getChangeRequestById(requestId);
  },

  updateChangeRequestById(requestId, payload) {
    return ProgramChangeRequestDAO.updateChangeRequestById(requestId, payload);
  }
};

module.exports = ProgramChangeRequestService;
