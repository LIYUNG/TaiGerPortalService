import { FilterQuery } from 'mongoose';
import { IInterval } from '@taiger-common/model';
import TeamDAO from '../dao/team.dao';

/**
 * TeamService — business layer for the internal team dashboards / task
 * overviews. Delegates the analytics queries to the DAO
 * (controller -> service -> dao).
 */
const TeamService = {
  getActivePrograms() {
    return TeamDAO.getActivePrograms();
  },

  getTeamMembers() {
    return TeamDAO.getTeamMembers();
  },

  getGeneralTasks() {
    return TeamDAO.getGeneralTasks();
  },

  getDecidedApplicationsTasks() {
    return TeamDAO.getDecidedApplicationsTasks();
  },

  getFileTypeCounts() {
    return TeamDAO.getFileTypeCounts();
  },

  getAgentStudentDistData(agentId: string) {
    return TeamDAO.getAgentStudentDistData(agentId);
  },

  getEditorTaskRows() {
    return TeamDAO.getEditorTaskRows();
  },

  getStudentsCreationData() {
    return TeamDAO.getStudentsCreationData();
  },

  getStudentAvgResponseTime() {
    return TeamDAO.getStudentAvgResponseTime();
  },

  getKpiFinishedDocs() {
    return TeamDAO.getKpiFinishedDocs();
  },

  getResponseTimesByStudent(studentId: string) {
    return TeamDAO.getResponseTimesByStudent(studentId);
  },

  getIntervals(filter: FilterQuery<IInterval>) {
    return TeamDAO.getIntervals(filter);
  }
};

export = TeamService;
