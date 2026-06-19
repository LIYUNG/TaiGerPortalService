import { FilterQuery, UpdateQuery, PipelineStage } from 'mongoose';
import { IInterview, IInterviewSurveyResponse } from '@taiger-common/model';
import InterviewDAO from '../dao/interview.dao';
import InterviewSurveyResponseDAO from '../dao/interviewSurveyResponse.dao';

type PopulateArgs = [string, ...unknown[]];

/**
 * InterviewService — business layer; delegates data access to the Interview and
 * InterviewSurveyResponse DAOs (controller -> service -> dao).
 */
const InterviewService = {
  getInterviews(filter: FilterQuery<IInterview>) {
    return InterviewDAO.getInterviews(filter);
  },

  getInterviewById(id: string) {
    return InterviewDAO.getInterviewById(id);
  },

  getInterviewsByStudentId(studentId: string) {
    return InterviewDAO.getInterviewsByStudentId(studentId);
  },

  findByIdRaw(id: string) {
    return InterviewDAO.findByIdRaw(id);
  },

  findInterviews(filter: FilterQuery<IInterview>, populates: unknown[][]) {
    return InterviewDAO.findInterviews(filter, populates);
  },

  findInterviewByIdPopulated(id: string, populates: unknown[][]) {
    return InterviewDAO.findInterviewByIdPopulated(id, populates);
  },

  findOneInterview(filter: FilterQuery<IInterview>, populates: unknown[][]) {
    return InterviewDAO.findOneInterview(filter, populates);
  },

  distinctTrainedStudentIds(studentIds: string[]) {
    return InterviewDAO.distinctTrainedStudentIds(studentIds);
  },

  updateInterviewByIdRaw(id: string, payload: UpdateQuery<IInterview>) {
    return InterviewDAO.updateInterviewByIdRaw(id, payload);
  },

  updateInterviewByIdPopulated(
    id: string,
    payload: UpdateQuery<IInterview>,
    populates: unknown[][]
  ) {
    return InterviewDAO.updateInterviewByIdPopulated(id, payload, populates);
  },

  upsertInterviewPopulated(
    filter: FilterQuery<IInterview>,
    payload: UpdateQuery<IInterview>,
    populates: unknown[][]
  ) {
    return InterviewDAO.upsertInterviewPopulated(filter, payload, populates);
  },

  deleteInterviewById(id: string) {
    return InterviewDAO.deleteInterviewById(id);
  },

  aggregateInterviews(pipeline: PipelineStage[]) {
    return InterviewDAO.aggregateInterviews(pipeline);
  },

  getInterviewsPaginated(args: {
    filter?: FilterQuery<IInterview>;
    query?: Record<string, unknown>;
  }) {
    return InterviewDAO.getInterviewsPaginated(args);
  },

  studentInterviewProgramIds(studentId: string) {
    return InterviewDAO.studentInterviewProgramIds(studentId);
  },

  // ── InterviewSurveyResponse ────────────────────────────────────────────────
  findSurveys(
    filter: FilterQuery<IInterviewSurveyResponse>,
    populates: PopulateArgs[]
  ) {
    return InterviewSurveyResponseDAO.findSurveys(filter, populates);
  },

  findOneSurvey(
    filter: FilterQuery<IInterviewSurveyResponse>,
    populates: PopulateArgs[]
  ) {
    return InterviewSurveyResponseDAO.findOneSurvey(filter, populates);
  },

  upsertSurvey(
    filter: FilterQuery<IInterviewSurveyResponse>,
    payload: Partial<IInterviewSurveyResponse>,
    populates: PopulateArgs[]
  ) {
    return InterviewSurveyResponseDAO.upsertSurvey(filter, payload, populates);
  },

  deleteOneSurvey(filter: FilterQuery<IInterviewSurveyResponse>) {
    return InterviewSurveyResponseDAO.deleteOneSurvey(filter);
  }
};

export = InterviewService;
