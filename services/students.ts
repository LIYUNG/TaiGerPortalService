import { FilterQuery, UpdateQuery } from 'mongoose';
import { IStudent } from '@taiger-common/model';
import StudentDAO from '../dao/student.dao';

/**
 * StudentService — business/orchestration layer for students.
 *
 * Data access lives in the DAO (dao/student.dao.js), which talks to the central
 * default-connection models. The service is the seam where student business
 * logic belongs; today most methods are thin pass-throughs to the DAO
 * (controller -> service -> dao).
 */
const StudentService = {
  fetchStudents(
    filter: FilterQuery<IStudent> = {},
    options: {
      sort?: Record<string, unknown>;
      skip?: number;
      limit?: number;
    } = {}
  ) {
    return StudentDAO.fetchStudents(filter, options);
  },

  fetchSimpleStudents(filter: FilterQuery<IStudent>) {
    return StudentDAO.fetchSimpleStudents(filter);
  },

  // Lean id-only variant for callers that only need the matching student ids.
  fetchStudentIds(filter: FilterQuery<IStudent>) {
    return StudentDAO.fetchStudentIds(filter);
  },

  getStudentsPaginated({
    filter = {},
    query = {}
  }: {
    filter?: FilterQuery<IStudent>;
    query?: Record<string, unknown>;
  }) {
    return StudentDAO.getStudentsPaginated({ filter, query });
  },

  getStudents({
    filter = {},
    options = {}
  }: {
    filter?: FilterQuery<IStudent>;
    options?: { sort?: Record<string, unknown>; skip?: number; limit?: number };
  }) {
    return StudentDAO.getStudents({ filter, options });
  },

  getStudentById(id: string) {
    return StudentDAO.getStudentById(id);
  },

  getStudentByIdLean(id: string) {
    return StudentDAO.getStudentByIdLean(id);
  },

  getStudentDocById(id: string) {
    return StudentDAO.getStudentDocById(id);
  },

  getStudentByIdPopulated(id: string, populates: unknown[][] = []) {
    return StudentDAO.getStudentByIdPopulated(id, populates);
  },

  getStudentDocByIdPopulated(id: string, populates: unknown[][] = []) {
    return StudentDAO.getStudentDocByIdPopulated(id, populates);
  },

  updateStudentByFilter(
    filter: FilterQuery<IStudent>,
    update: UpdateQuery<IStudent>
  ) {
    return StudentDAO.updateStudentByFilter(filter, update);
  },

  updateStudentByIdRaw(id: string, update: UpdateQuery<IStudent>) {
    return StudentDAO.updateStudentByIdRaw(id, update);
  },

  findStudents(filter: FilterQuery<IStudent> = {}) {
    return StudentDAO.findStudents(filter);
  },

  findStudentsWithTeamNames(filter: FilterQuery<IStudent> = {}) {
    return StudentDAO.findStudentsWithTeamNames(filter);
  },

  countStudents(filter: FilterQuery<IStudent> = {}) {
    return StudentDAO.countStudents(filter);
  },

  getStudentApplicationsForIntervals(studentId: string) {
    return StudentDAO.getStudentApplicationsForIntervals(studentId);
  },

  findStudentsSelect(
    filter: FilterQuery<IStudent> = {},
    select = '',
    limit: number | undefined = undefined
  ) {
    return StudentDAO.findStudentsSelect(filter, select, limit);
  },

  getStudentByIdSelect(id: string, select: string) {
    return StudentDAO.getStudentByIdSelect(id, select);
  },

  getStudentByIdSelectPopulated(
    id: string,
    select: string,
    populate: string,
    populateSelect: string
  ) {
    return StudentDAO.getStudentByIdSelectPopulated(
      id,
      select,
      populate,
      populateSelect
    );
  },

  searchStudentsByText(
    filter: FilterQuery<IStudent>,
    select: string,
    limit?: number
  ) {
    return StudentDAO.searchStudentsByText(filter, select, limit);
  },

  getStudentsWithLatestCommunication() {
    return StudentDAO.getStudentsWithLatestCommunication();
  },

  getUnreadCommunicationStudents(studentIds: string[], userId: string) {
    return StudentDAO.getUnreadCommunicationStudents(studentIds, userId);
  },

  getStudentsWithLatestCommunicationSorted(studentIds: string[]) {
    return StudentDAO.getStudentsWithLatestCommunicationSorted(studentIds);
  },

  getStudentsWithCourses() {
    return StudentDAO.getStudentsWithCourses();
  },

  getStudentsWithCoursesAndAgents() {
    return StudentDAO.getStudentsWithCoursesAndAgents();
  },

  getStudentsForDocumentThreadIntervals(filter: FilterQuery<IStudent>) {
    return StudentDAO.getStudentsForDocumentThreadIntervals(filter);
  },

  getTaigerUsersWithExpenses() {
    return StudentDAO.getTaigerUsersWithExpenses();
  },

  getStudentsWithExpenses() {
    return StudentDAO.getStudentsWithExpenses();
  },

  getStudentsForExpenses(filter: FilterQuery<IStudent>) {
    return StudentDAO.getStudentsForExpenses(filter);
  },

  getStudentByIdWithAgents(id: string) {
    return StudentDAO.getStudentByIdWithAgents(id);
  },

  getStudentByIdWithTeam(id: string) {
    return StudentDAO.getStudentByIdWithTeam(id);
  },

  getStudentByIdWithDocThreads(id: string) {
    return StudentDAO.getStudentByIdWithDocThreads(id);
  },

  updateStudentById(id: string, update: UpdateQuery<IStudent>) {
    return StudentDAO.updateStudentById(id, update);
  },

  getStudentsWithApplications(filter: FilterQuery<IStudent>) {
    return StudentDAO.getStudentsWithApplications(filter);
  }
};

export = StudentService;
