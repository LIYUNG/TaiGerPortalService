import {
  FilterQuery,
  UpdateQuery,
  PipelineStage,
  AnyBulkWriteOperation
} from 'mongoose';
import { IApplication } from '@taiger-common/model';
import ApplicationDAO from '../dao/application.dao';

/**
 * ApplicationService — business/orchestration layer for applications.
 * Data access lives in dao/application.dao.js (central default-connection
 * models). Controller -> service -> dao.
 */
const ApplicationService = {
  createApplication(studentId: string, programId: string) {
    return ApplicationDAO.createApplication(studentId, programId);
  },

  getActiveStudentsApplicationsPaginated({
    studentIds = [],
    query = {}
  }: {
    studentIds?: string[];
    query?: Record<string, unknown>;
  }) {
    return ApplicationDAO.getActiveStudentsApplicationsPaginated({
      studentIds,
      query
    });
  },

  getActiveStudentsApplicationsDeadlineDistribution({
    studentIds = []
  }: {
    studentIds?: string[];
  }) {
    return ApplicationDAO.getActiveStudentsApplicationsDeadlineDistribution({
      studentIds
    });
  },

  getApplicationProgramsUpdateStatus({
    studentIds = [],
    decided
  }: {
    studentIds?: string[];
    decided?: string;
  }) {
    return ApplicationDAO.getApplicationProgramsUpdateStatus({
      studentIds,
      decided
    });
  },

  getApplicationStatusStats({ studentIds = [] }: { studentIds?: string[] }) {
    return ApplicationDAO.getApplicationStatusStats({ studentIds });
  },

  // Returns a Mongoose query (callers may chain .select()/.lean()).
  getApplications(
    filter: FilterQuery<IApplication> = {},
    select: string[] = [],
    populate: boolean | string = true
  ) {
    return ApplicationDAO.getApplications(filter, select, populate);
  },

  getApplicationsWithStudentDetails(filter: FilterQuery<IApplication>) {
    return ApplicationDAO.getApplicationsWithStudentDetails(filter);
  },

  getApplicationsByStudentId(studentId: string) {
    return ApplicationDAO.getApplicationsByStudentId(studentId);
  },

  createApplicationDoc(payload: Partial<IApplication>) {
    return ApplicationDAO.createApplicationDoc(payload);
  },

  findByStudentIdPopulatedBasic(studentId: string) {
    return ApplicationDAO.findByStudentIdPopulatedBasic(studentId);
  },

  findByStudentIdPopulatedFull(studentId: string) {
    return ApplicationDAO.findByStudentIdPopulatedFull(studentId);
  },

  unlockApplication(applicationId: string) {
    return ApplicationDAO.unlockApplication(applicationId);
  },

  getApplicationDocByIdWithProgram(applicationId: string) {
    return ApplicationDAO.getApplicationDocByIdWithProgram(applicationId);
  },

  getApplicationByIdWithStudentProgram(applicationId: string) {
    return ApplicationDAO.getApplicationByIdWithStudentProgram(applicationId);
  },

  aggregateApplications(pipeline: PipelineStage[]) {
    return ApplicationDAO.aggregateApplications(pipeline);
  },

  findApplicationsSelectPopulate(
    filter: FilterQuery<IApplication>,
    select: string,
    populate?: { path: string; select?: string }
  ) {
    return ApplicationDAO.findApplicationsSelectPopulate(
      filter,
      select,
      populate
    );
  },

  findByStudentIdLean(studentId: string) {
    return ApplicationDAO.findByStudentIdLean(studentId);
  },

  findByStudentIdWithProgram(studentId: string) {
    return ApplicationDAO.findByStudentIdWithProgram(studentId);
  },

  findConflictApplications(filter: FilterQuery<IApplication>) {
    return ApplicationDAO.findConflictApplications(filter);
  },

  pullDocModificationThread(applicationId: string, threadId: string) {
    return ApplicationDAO.pullDocModificationThread(applicationId, threadId);
  },

  getDecidedApplicationsByProgramPopulated(programId: string) {
    return ApplicationDAO.getDecidedApplicationsByProgramPopulated(programId);
  },

  getApplicationsWithCredentialsByStudentId(studentId: string) {
    return ApplicationDAO.getApplicationsWithCredentialsByStudentId(studentId);
  },

  getApplicationsByProgramId(programId: string) {
    return ApplicationDAO.getApplicationsByProgramId(programId);
  },

  getApplicationById(applicationId: string) {
    return ApplicationDAO.getApplicationById(applicationId);
  },

  updateApplication(
    filter: FilterQuery<IApplication>,
    payload: UpdateQuery<IApplication>
  ) {
    return ApplicationDAO.updateApplication(filter, payload);
  },

  deleteApplication(application_id: string) {
    return ApplicationDAO.deleteApplication(application_id);
  },

  updateApplicationsBulk(updates: AnyBulkWriteOperation[]) {
    return ApplicationDAO.updateApplicationsBulk(updates);
  },

  getApplicationConflicts() {
    return ApplicationDAO.getApplicationConflicts();
  },

  getAdmissionsStatusCounts() {
    return ApplicationDAO.getAdmissionsStatusCounts();
  },

  getProgramApplicationCounts() {
    return ApplicationDAO.getProgramApplicationCounts();
  }
};

export = ApplicationService;
