import { interviewSurveyResponseSchema } from '@taiger-common/model';

interviewSurveyResponseSchema.index(
  { student_id: 1, interview_id: 1 },
  { unique: true }
);

export = { interviewSurveyResponseSchema };
