import { FilterQuery, PipelineStage } from 'mongoose';
import { Role } from '@taiger-common/core';
import { IInterval } from '@taiger-common/model';
import {
  Application,
  User,
  Student,
  Interval,
  ResponseTime,
  Documentthread
} from '../models';

// Editor task-count pipelines (general-doc threads + decided-application
// threads). Kept as module constants so both the pipeline runners read the same
// definitions.
const GENERAL_EDITOR_TASKS_PIPELINE = [
  { $match: { $or: [{ archiv: { $exists: false } }, { archiv: false }] } },
  { $unwind: '$generaldocs_threads' },
  {
    $lookup: {
      from: 'documentthreads',
      localField: 'generaldocs_threads.doc_thread_id',
      foreignField: '_id',
      as: 'doc_thread'
    }
  },
  { $unwind: '$doc_thread' },
  { $unwind: '$editors' },
  {
    $project: {
      editor_id: '$editors',
      isFinalVersion: '$generaldocs_threads.isFinalVersion',
      show: { $literal: true },
      isPotentials: { $literal: false }
    }
  }
];

const APPLICATION_EDITOR_TASKS_PIPELINE = [
  {
    $lookup: {
      from: 'users',
      localField: 'studentId',
      foreignField: '_id',
      as: 'student'
    }
  },
  { $unwind: '$student' },
  {
    $match: {
      $or: [
        { 'student.archiv': { $exists: false } },
        { 'student.archiv': false }
      ]
    }
  },
  { $unwind: '$doc_modification_thread' },
  {
    $lookup: {
      from: 'documentthreads',
      localField: 'doc_modification_thread.doc_thread_id',
      foreignField: '_id',
      as: 'doc_thread'
    }
  },
  { $unwind: '$doc_thread' },
  { $unwind: '$student.editors' },
  {
    $project: {
      editor_id: '$student.editors',
      isFinalVersion: '$doc_modification_thread.isFinalVersion',
      show: {
        $cond: { if: { $eq: ['$decided', 'O'] }, then: true, else: false }
      },
      isPotentials: {
        $cond: { if: { $eq: ['$decided', '-'] }, then: true, else: false }
      }
    }
  }
];

const GENERAL_TASKS_PIPELINE = [
  { $match: { $or: [{ archiv: { $exists: false } }, { archiv: false }] } },
  { $unwind: '$generaldocs_threads' },
  {
    $lookup: {
      from: 'documentthreads',
      localField: 'generaldocs_threads.doc_thread_id',
      foreignField: '_id',
      as: 'doc_thread'
    }
  },
  { $unwind: '$doc_thread' }
];

const STUDENT_AVG_RESPONSE_TIME_PIPELINE = [
  {
    $group: {
      _id: { student_id: '$student_id', interval_type: '$interval_type' },
      typeAvg: { $avg: '$intervalAvg' }
    }
  },
  { $replaceRoot: { newRoot: { $mergeObjects: ['$_id', '$$ROOT'] } } },
  {
    $group: {
      _id: '$student_id',
      avgByType: { $push: { k: '$interval_type', v: '$typeAvg' } }
    }
  },
  {
    $lookup: {
      from: 'users',
      localField: '_id',
      foreignField: '_id',
      as: 'student'
    }
  },
  { $unwind: '$student' },
  {
    $project: {
      _id: 1,
      agents: '$student.agents',
      editors: '$student.editors',
      lastname_chinese: '$student.lastname_chinese',
      firstname_chinese: '$student.firstname_chinese',
      name: { $concat: ['$student.firstname', ' ', '$student.lastname'] },
      avgByType: { $arrayToObject: '$avgByType' }
    }
  }
];

/**
 * TeamDAO — read-only analytics queries backing the internal team dashboards
 * and task overviews. Uses the central default-connection models; plain params,
 * no req.
 */
const TeamDAO = {
  async getActivePrograms() {
    return Application.aggregate([
      { $match: { decided: 'O', closed: '-' } },
      {
        $lookup: {
          from: 'users',
          localField: 'studentId',
          foreignField: '_id',
          as: 'studentId'
        }
      },
      { $unwind: '$studentId' },
      { $match: { 'studentId.archiv': { $ne: true } } },
      { $group: { _id: '$programId', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
  },

  async getTeamMembers() {
    return User.aggregate([
      {
        $match: {
          role: { $in: [Role.Admin, Role.Agent, Role.Editor] },
          $or: [{ archiv: { $exists: false } }, { archiv: false }]
        }
      },
      {
        $lookup: {
          from: 'permissions',
          localField: '_id',
          foreignField: 'user_id',
          as: 'permissions'
        }
      }
    ]);
  },

  async getGeneralTasks() {
    return Student.aggregate([
      ...GENERAL_TASKS_PIPELINE,
      {
        $project: {
          isFinalVersion: '$generaldocs_threads.isFinalVersion',
          latest_message_left_by_id:
            '$generaldocs_threads.latest_message_left_by_id',
          doc_thread_id: '$generaldocs_threads.doc_thread_id',
          updatedAt: '$generaldocs_threads.updatedAt',
          createdAt: '$generaldocs_threads.createdAt',
          _id: '$generaldocs_threads._id',
          file_type: '$doc_thread.file_type'
        }
      }
    ]);
  },

  async getDecidedApplicationsTasks() {
    return Student.aggregate([
      { $match: { $or: [{ archiv: { $exists: false } }, { archiv: false }] } },
      { $unwind: '$applications' },
      { $match: { 'applications.decided': 'O' } },
      { $unwind: '$applications.doc_modification_thread' },
      {
        $lookup: {
          from: 'documentthreads',
          localField: 'applications.doc_modification_thread.doc_thread_id',
          foreignField: '_id',
          as: 'doc_thread'
        }
      },
      { $unwind: '$doc_thread' },
      {
        $lookup: {
          from: 'programs',
          localField: 'applications.programId',
          foreignField: '_id',
          as: 'program'
        }
      },
      { $unwind: '$program' },
      {
        $project: {
          isFinalVersion:
            '$applications.doc_modification_thread.isFinalVersion',
          latest_message_left_by_id:
            '$applications.doc_modification_thread.latest_message_left_by_id',
          doc_thread_id: '$applications.doc_modification_thread.doc_thread_id',
          updatedAt: '$applications.doc_modification_thread.updatedAt',
          createdAt: '$applications.doc_modification_thread.createdAt',
          _id: '$applications.doc_modification_thread._id',
          file_type: '$doc_thread.file_type',
          program_id: {
            _id: '$program._id',
            application_deadline: '$program.application_deadline'
          },
          application_year: '$applications.application_year'
        }
      }
    ]);
  },

  // Two file_type-count aggregations (general docs + decided application docs).
  async getFileTypeCounts() {
    const [counts1, counts2] = await Promise.all([
      Student.aggregate([
        ...GENERAL_TASKS_PIPELINE,
        { $group: { _id: '$doc_thread.file_type', count: { $sum: 1 } } }
      ]),
      Student.aggregate([
        {
          $match: { $or: [{ archiv: { $exists: false } }, { archiv: false }] }
        },
        { $unwind: '$applications' },
        { $match: { 'applications.decided': 'O' } },
        { $unwind: '$applications.doc_modification_thread' },
        {
          $lookup: {
            from: 'documentthreads',
            localField: 'applications.doc_modification_thread.doc_thread_id',
            foreignField: '_id',
            as: 'doc_thread'
          }
        },
        { $unwind: '$doc_thread' },
        { $group: { _id: '$doc_thread.file_type', count: { $sum: 1 } } }
      ])
    ]);
    return { counts1, counts2 };
  },

  async getAgentStudentDistData(agentId: string) {
    const distPipeline = (admissionMatch: unknown): PipelineStage[] => [
      {
        $match: {
          archiv: { $ne: true },
          agents: agentId,
          'applications.admission': admissionMatch
        }
      },
      {
        $group: {
          _id: {
            expected_application_date:
              '$application_preference.expected_application_date'
          },
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          expected_application_date: '$_id.expected_application_date',
          count: 1
        }
      },
      { $sort: { expected_application_date: 1 } }
    ];

    const [admission, noAdmission] = await Promise.all([
      Student.aggregate(distPipeline('O')),
      Student.aggregate(distPipeline({ $ne: 'O' }))
    ]);
    return { admission, noAdmission };
  },

  async getEditorTaskRows() {
    const [generalTasks, applicationTasks] = await Promise.all([
      Student.aggregate(GENERAL_EDITOR_TASKS_PIPELINE),
      Application.aggregate(APPLICATION_EDITOR_TASKS_PIPELINE)
    ]);
    return [...generalTasks, ...applicationTasks];
  },

  async getStudentsCreationData() {
    return Student.aggregate([
      { $match: { $or: [{ archiv: { $exists: false } }, { archiv: false }] } },
      { $project: { createdAt: 1, application_preference: 1 } }
    ]);
  },

  async getStudentAvgResponseTime() {
    return ResponseTime.aggregate(STUDENT_AVG_RESPONSE_TIME_PIPELINE);
  },

  async getKpiFinishedDocs() {
    return Documentthread.find({
      isFinalVersion: true,
      $or: [
        { file_type: 'CV' },
        { file_type: 'CV_US' },
        { file_type: 'ML' },
        { file_type: 'RL_A' },
        { file_type: 'RL_B' },
        { file_type: 'RL_C' },
        { file_type: 'Recommendation_Letter_A' },
        { file_type: 'Recommendation_Letter_B' },
        { file_type: 'Recommendation_Letter_C' }
      ]
    })
      .populate('student_id', 'firstname lastname')
      .select('file_type messages.createdAt')
      .lean();
  },

  async getResponseTimesByStudent(studentId: string) {
    return ResponseTime.find({ student_id: studentId });
  },

  async getIntervals(filter: FilterQuery<IInterval>) {
    return Interval.find(filter).select('-updatedAt -_id -student_id').lean();
  }
};

export = TeamDAO;
