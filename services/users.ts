import { FilterQuery, UpdateQuery, QueryOptions, SortOrder } from 'mongoose';
import { IUser } from '@taiger-common/model';
import UserDAO from '../dao/user.dao';

/**
 * UserService — business layer for users. Delegates data access to the DAO
 * (controller -> service -> dao). `parseUsersPaginationQuery` is a pure helper
 * exposed for controllers that build the pagination args.
 */
const UserService = {
  parseUsersPaginationQuery(query: {
    page?: string | number;
    limit?: string | number;
    search?: string;
    sortBy?: string;
    sortOrder?: string;
  }) {
    return UserDAO.parseUsersPaginationQuery(query);
  },

  getUserById(userId: string) {
    return UserDAO.getUserById(userId);
  },

  getUsers(query: FilterQuery<IUser>) {
    return UserDAO.getUsers(query);
  },

  findUsersByIds(ids: string[], select: string) {
    return UserDAO.findUsersByIds(ids, select);
  },

  getUsersPaginated(args: {
    filter: FilterQuery<IUser>;
    page: number;
    limit: number;
    skip: number;
    search: string;
    sort: Record<string, SortOrder>;
  }) {
    return UserDAO.getUsersPaginated(args);
  },

  updateUser(userId: string, payload: UpdateQuery<IUser>) {
    return UserDAO.updateUser(userId, payload);
  },

  updateOfficehours(
    userId: string,
    role: string,
    payload: { officehours?: unknown; timezone?: string }
  ) {
    return UserDAO.updateOfficehours(userId, role, payload);
  },

  updateUserDoc(
    userId: string,
    payload: UpdateQuery<IUser>,
    options: QueryOptions<IUser> = { new: true }
  ) {
    return UserDAO.updateUserDoc(userId, payload, options);
  },

  getUserByEmail(email: string) {
    return UserDAO.getUserByEmail(email);
  },

  getUserByFilter(filter: FilterQuery<IUser>) {
    return UserDAO.getUserByFilter(filter);
  },

  getUserDocByFilter(filter: FilterQuery<IUser>) {
    return UserDAO.getUserDocByFilter(filter);
  },

  createGuest(payload: Partial<IUser>) {
    return UserDAO.createGuest(payload);
  },

  getUserByIdSelect(userId: string, select: string) {
    return UserDAO.getUserByIdSelect(userId, select);
  },

  getUserDocWithPasswordByEmail(email: string) {
    return UserDAO.getUserDocWithPasswordByEmail(email);
  },

  touchLastLoginByEmail(email: string) {
    return UserDAO.touchLastLoginByEmail(email);
  },

  touchLastLoginById(userId: string) {
    return UserDAO.touchLastLoginById(userId);
  },

  findAgents(filter: FilterQuery<IUser>, select: string) {
    return UserDAO.findAgents(filter, select);
  },

  findEditors(filter: FilterQuery<IUser>, select: string) {
    return UserDAO.findEditors(filter, select);
  },

  findAgentById(agentId: string, select: string) {
    return UserDAO.findAgentById(agentId, select);
  },

  getUserDocById(userId: string) {
    return UserDAO.getUserDocById(userId);
  },

  getAgentDocById(agentId: string) {
    return UserDAO.getAgentDocById(agentId);
  },

  createUser(role: string, payload: Partial<IUser>) {
    return UserDAO.createUser(role, payload);
  },

  updateUserWithOptions(
    userId: string,
    fields: UpdateQuery<IUser>,
    options: QueryOptions<IUser>
  ) {
    return UserDAO.updateUserWithOptions(userId, fields, options);
  },

  updateUserArchiv(userId: string, isArchived: boolean) {
    return UserDAO.updateUserArchiv(userId, isArchived);
  },

  deleteUserById(userId: string) {
    return UserDAO.deleteUserById(userId);
  },

  pullStaffFromStudents(userId: string) {
    return UserDAO.pullStaffFromStudents(userId);
  },

  deleteStudentCascade(userId: string) {
    return UserDAO.deleteStudentCascade(userId);
  },

  getUserRoleCounts() {
    return UserDAO.getUserRoleCounts();
  },

  getUsersOverview() {
    return UserDAO.getUsersOverview();
  }
};

export = UserService;
