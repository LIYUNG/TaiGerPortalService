import { FilterQuery, Query } from 'mongoose';
import { IInterviewSurveyResponse } from '@taiger-common/model';
import { InterviewSurveyResponse } from '../models';

type PopulateArgs = [string, ...unknown[]];

const applyPopulates = (
  query: Query<unknown, unknown>,
  populates: PopulateArgs[] = []
) =>
  populates.reduce(
    (populated, args) =>
      (populated.populate as (...a: unknown[]) => Query<unknown, unknown>)(
        ...args
      ),
    query
  );

/**
 * InterviewSurveyResponseDAO — data access for the InterviewSurveyResponse model
 * (central default-connection model). Plain params, no req.
 */
const InterviewSurveyResponseDAO = {
  async findSurveys(
    filter: FilterQuery<IInterviewSurveyResponse> = {},
    populates: PopulateArgs[] = []
  ) {
    return applyPopulates(
      InterviewSurveyResponse.find(filter),
      populates
    ).lean();
  },

  async findOneSurvey(
    filter: FilterQuery<IInterviewSurveyResponse>,
    populates: PopulateArgs[] = []
  ) {
    return applyPopulates(
      InterviewSurveyResponse.findOne(filter),
      populates
    ).lean();
  },

  async upsertSurvey(
    filter: FilterQuery<IInterviewSurveyResponse>,
    payload: Partial<IInterviewSurveyResponse>,
    populates: PopulateArgs[] = []
  ) {
    return applyPopulates(
      InterviewSurveyResponse.findOneAndUpdate(filter, payload, {
        new: true,
        upsert: true
      }),
      populates
    ).lean();
  },

  async deleteOneSurvey(filter: FilterQuery<IInterviewSurveyResponse>) {
    return InterviewSurveyResponse.findOneAndDelete(filter);
  }
};

export = InterviewSurveyResponseDAO;
