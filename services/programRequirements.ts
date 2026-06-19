import { UpdateQuery } from 'mongoose';
import { IProgramrequirement } from '@taiger-common/model';
import ProgramRequirementDAO from '../dao/programRequirement.dao';
import ProgramDAO from '../dao/program.dao';
import KeywordSetDAO from '../dao/keywordset.dao';

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

  getProgramRequirementById(requirementId: string) {
    return ProgramRequirementDAO.getProgramRequirementById(requirementId);
  },

  findProgramsBySchoolNameDegree(program: {
    school: string;
    program_name: string;
    degree: string;
  }) {
    return ProgramDAO.findProgramsBySchoolNameDegree(program);
  },

  getProgramRequirementsByProgramIds(programIds: string[]) {
    return ProgramRequirementDAO.getProgramRequirementsByProgramIds(programIds);
  },

  createProgramRequirement(payload: Partial<IProgramrequirement>) {
    return ProgramRequirementDAO.createProgramRequirement(payload);
  },

  updateProgramRequirementById(
    requirementId: string,
    fields: UpdateQuery<IProgramrequirement>
  ) {
    return ProgramRequirementDAO.updateProgramRequirementById(
      requirementId,
      fields
    );
  },

  deleteProgramRequirementById(requirementId: string) {
    return ProgramRequirementDAO.deleteProgramRequirementById(requirementId);
  },

  deleteOneByProgramIds(programIds: string[]) {
    return ProgramRequirementDAO.deleteOneByProgramIds(programIds);
  }
};

export = ProgramRequirementService;
