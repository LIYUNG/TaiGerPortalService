import ProgramAIDAO from '../dao/programAI.dao';

/**
 * ProgramAIService — business layer for AI-generated program metadata.
 * Delegates data access to the DAO (controller -> service -> dao).
 */
const ProgramAIService = {
  getByProgramId(programId) {
    return ProgramAIDAO.getByProgramId(programId);
  }
};

module.exports = ProgramAIService;
