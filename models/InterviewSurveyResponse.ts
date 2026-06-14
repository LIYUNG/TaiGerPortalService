const { interviewSurveyResponseSchema } = require('@taiger-common/model');

interviewSurveyResponseSchema.index(
  { student_id: 1, interview_id: 1 },
  { unique: true }
);

module.exports = { interviewSurveyResponseSchema };
