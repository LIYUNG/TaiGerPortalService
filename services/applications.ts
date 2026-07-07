import {
  FilterQuery,
  UpdateQuery,
  PipelineStage,
  AnyBulkWriteOperation
} from 'mongoose';
import { IApplication } from '@taiger-common/model';
import ApplicationDAO from '../dao/application.dao';

/**
 * Strategy contract for application data access. Structural-only conversion: the
 * contract is derived from the MongoDB DAO's shape (its public methods), so a
 * future PostgreSQL DAO can be swapped in by matching it. Returns/behaviour are
 * intentionally UNCHANGED from the legacy object DAO (live docs stay live for
 * `.save()` callers, aggregations and FilterQuery params are preserved) — the
 * domain-mapping / filter de-leaking is deferred for this large, hot domain.
 */
type IApplicationDAO = typeof ApplicationDAO;

/**
 * ApplicationService — business/orchestration layer for applications. Depends on
 * the IApplicationDAO strategy contract via constructor injection
 * (controller -> service -> dao).
 */
class ApplicationService {
  constructor(private readonly dao: IApplicationDAO) {}

  createApplication(studentId: string, programId: string) {
    return this.dao.createApplication(studentId, programId);
  }

  getStudentsApplicationsPaginated({
    studentIds = [],
    query = {}
  }: {
    studentIds?: string[];
    query?: Record<string, unknown>;
  }) {
    return this.dao.getStudentsApplicationsPaginated({
      studentIds,
      query
    });
  }

  getActiveStudentsApplicationsDeadlineDistribution({
    studentIds = []
  }: {
    studentIds?: string[];
  }) {
    return this.dao.getActiveStudentsApplicationsDeadlineDistribution({
      studentIds
    });
  }

  getApplicationProgramsUpdateStatus({
    studentIds = [],
    decided
  }: {
    studentIds?: string[];
    decided?: string;
  }) {
    return this.dao.getApplicationProgramsUpdateStatus({
      studentIds,
      decided
    });
  }

  getApplicationStatusStats({ studentIds = [] }: { studentIds?: string[] }) {
    return this.dao.getApplicationStatusStats({ studentIds });
  }

  // Returns a Mongoose query (callers may chain .select()/.lean()).
  getApplications(
    filter: FilterQuery<IApplication> = {},
    select: string[] = [],
    populate: boolean | string = true
  ) {
    return this.dao.getApplications(filter, select, populate);
  }

  getApplicationsWithStudentDetails(filter: FilterQuery<IApplication>) {
    return this.dao.getApplicationsWithStudentDetails(filter);
  }

  getApplicationsByStudentId(studentId: string) {
    return this.dao.getApplicationsByStudentId(studentId);
  }

  createApplicationDoc(payload: Partial<IApplication>) {
    return this.dao.createApplicationDoc(payload);
  }

  findByStudentIdPopulatedBasic(studentId: string) {
    return this.dao.findByStudentIdPopulatedBasic(studentId);
  }

  findByStudentIdPopulatedFull(studentId: string) {
    return this.dao.findByStudentIdPopulatedFull(studentId);
  }

  unlockApplication(applicationId: string) {
    return this.dao.unlockApplication(applicationId);
  }

  getApplicationDocByIdWithProgram(applicationId: string) {
    return this.dao.getApplicationDocByIdWithProgram(applicationId);
  }

  getApplicationByIdWithStudentProgram(applicationId: string) {
    return this.dao.getApplicationByIdWithStudentProgram(applicationId);
  }

  aggregateApplications(pipeline: PipelineStage[]) {
    return this.dao.aggregateApplications(pipeline);
  }

  findApplicationsSelectPopulate(
    filter: FilterQuery<IApplication>,
    select: string,
    populate?: { path: string; select?: string }
  ) {
    return this.dao.findApplicationsSelectPopulate(filter, select, populate);
  }

  findByStudentIdLean(studentId: string) {
    return this.dao.findByStudentIdLean(studentId);
  }

  findByStudentIdWithProgram(studentId: string) {
    return this.dao.findByStudentIdWithProgram(studentId);
  }

  findConflictApplications(filter: FilterQuery<IApplication>) {
    return this.dao.findConflictApplications(filter);
  }

  pullDocModificationThread(applicationId: string, threadId: string) {
    return this.dao.pullDocModificationThread(applicationId, threadId);
  }

  getDecidedApplicationsByProgramPopulated(programId: string) {
    return this.dao.getDecidedApplicationsByProgramPopulated(programId);
  }

  getApplicationsWithCredentialsByStudentId(studentId: string) {
    return this.dao.getApplicationsWithCredentialsByStudentId(studentId);
  }

  getApplicationsByProgramId(programId: string) {
    return this.dao.getApplicationsByProgramId(programId);
  }

  getApplicationById(applicationId: string) {
    return this.dao.getApplicationById(applicationId);
  }

  updateApplication(
    filter: FilterQuery<IApplication>,
    payload: UpdateQuery<IApplication>
  ) {
    return this.dao.updateApplication(filter, payload);
  }

  deleteApplication(application_id: string) {
    return this.dao.deleteApplication(application_id);
  }

  updateApplicationsBulk(updates: AnyBulkWriteOperation[]) {
    return this.dao.updateApplicationsBulk(updates);
  }

  getApplicationConflicts() {
    return this.dao.getApplicationConflicts();
  }

  getAdmissionsStatusCounts() {
    return this.dao.getAdmissionsStatusCounts();
  }

  getProgramApplicationCounts() {
    return this.dao.getProgramApplicationCounts();
  }
}

// Production instance, wired to the MongoDB strategy. `export =` (not
// `export default`) preserves the CommonJS module shape for existing
// `require('../services/applications')` consumers.
export = new ApplicationService(ApplicationDAO);
