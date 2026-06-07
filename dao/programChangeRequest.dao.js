const { ProgramChangeRequest } = require('../models');

/**
 * ProgramChangeRequestDAO — data access for the ProgramChangeRequest model
 * (default-connection model from models/index.js). Plain params, no req.
 */
const ProgramChangeRequestDAO = {
  async getOpenChangeRequestsByProgramId(programId) {
    return ProgramChangeRequest.find({
      programId,
      reviewedBy: { $exists: false }
    }).populate('requestedBy', 'firstname lastname');
  },

  // Upsert the open (not-yet-reviewed) change request for this program/user.
  async upsertChangeRequest(programId, requestedBy, changes) {
    return ProgramChangeRequest.findOneAndUpdate(
      {
        programId,
        requestedBy,
        reviewedBy: {
          $exists: false
        }
      },
      {
        programChanges: changes
      },
      { upsert: true }
    );
  },

  async getChangeRequestById(requestId) {
    return ProgramChangeRequest.findById(requestId);
  },

  async updateChangeRequestById(requestId, payload) {
    return ProgramChangeRequest.findByIdAndUpdate(requestId, payload, {
      new: true
    });
  }
};

module.exports = ProgramChangeRequestDAO;
