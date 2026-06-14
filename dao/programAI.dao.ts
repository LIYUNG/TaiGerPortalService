import { ProgramAI } from '../models';

/**
 * ProgramAIDAO — data access for the ProgramAI model (default-connection model
 * from models/index.js). Plain params, no req.
 */
const ProgramAIDAO = {
  async getByProgramId(programId) {
    return ProgramAI.findOne({ program_id: programId }).lean();
  }
};

module.exports = ProgramAIDAO;
