import { FilterQuery, UpdateQuery } from 'mongoose';
import { ISurveyInput } from '@taiger-common/model';
import { surveyInput } from '../models';

/**
 * SurveyInputDAO — data access for the surveyInput model (default-connection
 * model from models/index.js). Plain params, no req.
 */
const SurveyInputDAO = {
  async findSurveyInputs(filter: FilterQuery<ISurveyInput>) {
    return surveyInput
      .find(filter)
      .select(
        'programId fileType surveyType surveyContent isFinalVersion createdAt updatedAt'
      )
      .lean();
  },

  async getSurveyInputById(id: string) {
    return surveyInput.findById(id).lean();
  },

  async createSurveyInput(payload: Partial<ISurveyInput>) {
    return surveyInput.create(payload);
  },

  async updateSurveyInputById(id: string, payload: UpdateQuery<ISurveyInput>) {
    return surveyInput
      .findByIdAndUpdate(id, payload, { upsert: false, new: true })
      .lean();
  },

  async deleteSurveyInput(filter: FilterQuery<ISurveyInput>) {
    return surveyInput.deleteOne(filter);
  }
};

export = SurveyInputDAO;
