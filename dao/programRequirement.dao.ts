import { UpdateQuery } from 'mongoose';
import { IProgramrequirement } from '@taiger-common/model';
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

  async getProgramRequirementById(requirementId: string) {
    return ProgramRequirement.findById(requirementId)
      .populate('programId', 'school program_name degree')
      .populate('program_categories.keywordSets')
      .lean();
  },

  async getProgramRequirementsByProgramIds(programIds: string[]) {
    return ProgramRequirement.find({ programId: programIds }).lean();
  },

  async createProgramRequirement(payload: Partial<IProgramrequirement>) {
    return ProgramRequirement.create(payload);
  },

  async updateProgramRequirementById(
    requirementId: string,
    fields: UpdateQuery<IProgramrequirement>
  ) {
    return ProgramRequirement.findByIdAndUpdate(requirementId, fields, {
      upsert: false,
      new: true
    }).lean();
  },

  async deleteProgramRequirementById(requirementId: string) {
    return ProgramRequirement.findByIdAndDelete(requirementId);
  },

  async deleteOneByProgramIds(programIds: string[]) {
    return ProgramRequirement.findOneAndDelete({
      programId: { $in: programIds }
    });
  },

  // Pull a deleted keyword set's id out of every requirement's
  // program_categories.keywordSets arrays.
  async removeKeywordSetReferences(keywordsSetId: string) {
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

export = ProgramRequirementDAO;
