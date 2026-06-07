const { surveyInput } = require('../models');

/**
 * SurveyInputDAO — data access for the surveyInput model (default-connection
 * model from models/index.js). Plain params, no req.
 */
const SurveyInputDAO = {
  async findSurveyInputs(filter) {
    return surveyInput
      .find(filter)
      .select(
        'programId fileType surveyType surveyContent isFinalVersion createdAt updatedAt'
      )
      .lean();
  },

  async getSurveyInputById(id) {
    return surveyInput.findById(id).lean();
  },

  async createSurveyInput(payload) {
    return surveyInput.create(payload);
  },

  async updateSurveyInputById(id, payload) {
    return surveyInput
      .findByIdAndUpdate(id, payload, { upsert: false, new: true })
      .lean();
  },

  // Reset answers — returns the live document (matches legacy behaviour, which
  // did not call .lean()).
  async resetSurveyInputById(id) {
    return surveyInput.findByIdAndUpdate(
      id,
      { $unset: { 'surveyContent.$[].answer': 1 } },
      { upsert: false, new: true }
    );
  },

  async deleteSurveyInput(filter) {
    return surveyInput.deleteOne(filter);
  }
};

module.exports = SurveyInputDAO;
