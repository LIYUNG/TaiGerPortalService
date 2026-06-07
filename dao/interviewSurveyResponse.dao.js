const { InterviewSurveyResponse } = require('../models');

const applyPopulates = (query, populates = []) => {
  populates.forEach((args) => {
    query = query.populate(...args);
  });
  return query;
};

/**
 * InterviewSurveyResponseDAO — data access for the InterviewSurveyResponse model
 * (central default-connection model). Plain params, no req.
 */
const InterviewSurveyResponseDAO = {
  async findSurveys(filter = {}, populates = []) {
    return applyPopulates(
      InterviewSurveyResponse.find(filter),
      populates
    ).lean();
  },

  async findOneSurvey(filter, populates = []) {
    return applyPopulates(
      InterviewSurveyResponse.findOne(filter),
      populates
    ).lean();
  },

  async upsertSurvey(filter, payload, populates = []) {
    return applyPopulates(
      InterviewSurveyResponse.findOneAndUpdate(filter, payload, {
        new: true,
        upsert: true
      }),
      populates
    ).lean();
  },

  async deleteOneSurvey(filter) {
    return InterviewSurveyResponse.findOneAndDelete(filter);
  }
};

module.exports = InterviewSurveyResponseDAO;
