import { ProgramChangeRequest } from '../models';

/**
 * ProgramChangeRequestDAO — data access for the ProgramChangeRequest model
 * (default-connection model from models/index.js). Plain params, no req.
 */
const ProgramChangeRequestDAO = {
  async getOpenChangeRequestsByProgramId(programId: string) {
    return ProgramChangeRequest.find({
      programId,
      reviewedBy: { $exists: false }
    }).populate('requestedBy', 'firstname lastname');
  },

  // Upsert the open (not-yet-reviewed) change request for this program/user.
  async upsertChangeRequest(
    programId: string,
    requestedBy: string,
    changes: Record<string, unknown>
  ) {
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

  async getChangeRequestById(requestId: string) {
    return ProgramChangeRequest.findById(requestId);
  },

  async updateChangeRequestById(
    requestId: string,
    payload: Record<string, unknown>
  ) {
    return ProgramChangeRequest.findByIdAndUpdate(requestId, payload, {
      new: true
    });
  }
};

export = ProgramChangeRequestDAO;
