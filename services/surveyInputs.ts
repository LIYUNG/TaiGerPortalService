import SurveyInputDAO from '../dao/surveyInput.dao';

/**
 * SurveyInputService — business layer for survey inputs. Delegates data access
 * to the DAO (controller -> service -> dao).
 */
const SurveyInputService = {
  findSurveyInputs(filter) {
    return SurveyInputDAO.findSurveyInputs(filter);
  },

  getSurveyInputById(id) {
    return SurveyInputDAO.getSurveyInputById(id);
  },

  createSurveyInput(payload) {
    return SurveyInputDAO.createSurveyInput(payload);
  },

  updateSurveyInputById(id, payload) {
    return SurveyInputDAO.updateSurveyInputById(id, payload);
  },

  deleteSurveyInput(filter) {
    return SurveyInputDAO.deleteSurveyInput(filter);
  }
};

export = SurveyInputService;
