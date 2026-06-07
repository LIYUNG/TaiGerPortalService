const ProgramRequirementDAO = require('../dao/programRequirement.dao');
const ProgramDAO = require('../dao/program.dao');
const KeywordSetDAO = require('../dao/keywordset.dao');

/**
 * ProgramRequirementService — business layer for program requirements. Composes
 * the ProgramRequirement / Program (read-only) / KeywordSet DAOs
 * (controller -> service -> dao).
 */
const ProgramRequirementService = {
  // Distinct programs + keyword sets used by the requirement editor.
  async getDistinctProgramsAndKeywordSets() {
    const [distinctPrograms, keywordsets] = await Promise.all([
      ProgramDAO.getDistinctSchoolProgramDegree(),
      KeywordSetDAO.getKeywordSets()
    ]);
    return { distinctPrograms, keywordsets };
  },

  getProgramRequirements() {
    return ProgramRequirementDAO.getProgramRequirements();
  },

  getProgramRequirementById(requirementId) {
    return ProgramRequirementDAO.getProgramRequirementById(requirementId);
  },

  findProgramsBySchoolNameDegree(program) {
    return ProgramDAO.findProgramsBySchoolNameDegree(program);
  },

  getProgramRequirementsByProgramIds(programIds) {
    return ProgramRequirementDAO.getProgramRequirementsByProgramIds(programIds);
  },

  createProgramRequirement(payload) {
    return ProgramRequirementDAO.createProgramRequirement(payload);
  },

  updateProgramRequirementById(requirementId, fields) {
    return ProgramRequirementDAO.updateProgramRequirementById(
      requirementId,
      fields
    );
  },

  deleteProgramRequirementById(requirementId) {
    return ProgramRequirementDAO.deleteProgramRequirementById(requirementId);
  }
};

module.exports = ProgramRequirementService;
