import { FilterQuery, UpdateQuery } from 'mongoose';
import { ISurveyInput } from '@taiger-common/model';
import SurveyInputDAO from '../dao/surveyInput.dao';

/**
 * SurveyInputService — business layer for survey inputs. Delegates data access
 * to the DAO (controller -> service -> dao).
 */
const SurveyInputService = {
  findSurveyInputs(filter: FilterQuery<ISurveyInput>) {
    return SurveyInputDAO.findSurveyInputs(filter);
  },

  getSurveyInputById(id: string) {
    return SurveyInputDAO.getSurveyInputById(id);
  },

  createSurveyInput(payload: Partial<ISurveyInput>) {
    return SurveyInputDAO.createSurveyInput(payload);
  },

  updateSurveyInputById(id: string, payload: UpdateQuery<ISurveyInput>) {
    return SurveyInputDAO.updateSurveyInputById(id, payload);
  },

  deleteSurveyInput(filter: FilterQuery<ISurveyInput>) {
    return SurveyInputDAO.deleteSurveyInput(filter);
  }
};

export = SurveyInputService;
