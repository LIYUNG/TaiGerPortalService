import { ProgramRequirement } from '../models';

/**
 * ProgramRequirementDAO — data access for the ProgramRequirement model
 * (default-connection model from models/index.js). Plain params, no req.
 */
const ProgramRequirementDAO = {
  async getProgramRequirements() {
    return ProgramRequirement.find({})
      .populate('programId program_categories.keywordSets')
      .sort({ createdAt: -1 });
  },

  async getProgramRequirementById(requirementId) {
    return ProgramRequirement.findById(requirementId)
      .populate('programId', 'school program_name degree')
      .populate('program_categories.keywordSets')
      .lean();
  },

  async getProgramRequirementsByProgramIds(programIds) {
    return ProgramRequirement.find({ programId: programIds }).lean();
  },

  async createProgramRequirement(payload) {
    return ProgramRequirement.create(payload);
  },

  async updateProgramRequirementById(requirementId, fields) {
    return ProgramRequirement.findByIdAndUpdate(requirementId, fields, {
      upsert: false,
      new: true
    }).lean();
  },

  async deleteProgramRequirementById(requirementId) {
    return ProgramRequirement.findByIdAndDelete(requirementId);
  },

  async deleteOneByProgramIds(programIds) {
    return ProgramRequirement.findOneAndDelete({
      programId: { $in: programIds }
    });
  },

  // Pull a deleted keyword set's id out of every requirement's
  // program_categories.keywordSets arrays.
  async removeKeywordSetReferences(keywordsSetId) {
    return ProgramRequirement.updateMany(
      { 'program_categories.keywordSets': keywordsSetId },
      {
        $pull: {
          'program_categories.$[].keywordSets': keywordsSetId
        }
      }
    );
  }
};

module.exports = ProgramRequirementDAO;
