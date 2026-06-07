const _ = require('lodash');
const { is_TaiGer_Agent } = require('@taiger-common/core');
const { Role } = require('@taiger-common/core');

const { asyncHandler } = require('../middlewares/error-handler');
const logger = require('../services/logger');
const { getStudentsByProgram } = require('./programs');
const { findStudentDeltaGet } = require('../utils/modelHelper/programChange');
const { GenerateResponseTimeByStudent } = require('./response_time');
const { numStudentYearDistribution } = require('../utils/utils_function');
const { ten_minutes_cache } = require('../cache/node-cache');
const StudentService = require('../services/students');
const UserQueryBuilder = require('../builders/UserQueryBuilder');
const InterviewQueryBuilder = require('../builders/InterviewQueryBuilder');
const InterviewService = require('../services/interviews');
const DocumentThreadService = require('../services/documentthreads');
const TeamService = require('../services/teams');
const UserService = require('../services/users');
const PermissionService = require('../services/permissions');
const ProgramService = require('../services/programs');

const getActivePrograms = asyncHandler(async () =>
  TeamService.getActivePrograms()
);

const getStudentDeltas = asyncHandler(
  async (req, student, program, options) => {
    const deltas = await findStudentDeltaGet(
      req,
      student._id,
      program,
      options || {}
    );
    if (deltas?.add?.length === 0 && deltas?.remove?.length === 0) {
      return;
    }
    const studentDelta = {
      _id: student._id,
      firstname: student.firstname,
      lastname: student.lastname,
      deltas
    };
    return studentDelta;
  }
);

const getApplicationDeltaByProgram = asyncHandler(async (req, programId) => {
  const students = await getStudentsByProgram(req, programId);
  const program = await ProgramService.getProgramByIdLean(programId);
  const studentDeltaPromises = [];
  const options = { skipCompleted: true };
  for (const student of students) {
    if (!student || student.closed !== '-') {
      continue;
    }
    const studentDelta = getStudentDeltas(req, student, program, options);
    studentDeltaPromises.push(studentDelta);
  }
  let studentDeltas = await Promise.all(studentDeltaPromises);
  studentDeltas = studentDeltas.filter((student) => student);
  const { _id, school, program_name, degree, semester } = program;
  return studentDeltas.length !== 0
    ? {
        program: { _id, school, program_name, degree, semester },
        students: studentDeltas
      }
    : {};
});

const getApplicationDeltas = asyncHandler(async (req, res) => {
  const activePrograms = await getActivePrograms(req);
  const deltaPromises = [];
  for (let program of activePrograms) {
    const programDeltaPromise = getApplicationDeltaByProgram(req, program._id);
    deltaPromises.push(programDeltaPromise);
  }
  const deltas = await Promise.all(deltaPromises);
  res.status(200).send({
    success: true,
    data: deltas.filter((obj) => Object.keys(obj).length !== 0)
  });
});

const getTeamMembers = asyncHandler(async (req, res) => {
  const users = await TeamService.getTeamMembers();
  res.status(200).send({ success: true, data: users });
});

const getGeneralTasks = asyncHandler(async () => TeamService.getGeneralTasks());

const getDecidedApplicationsTasks = asyncHandler(async () =>
  TeamService.getDecidedApplicationsTasks()
);

const getFileTypeCount = asyncHandler(async (req) => {
  // TODO not accurate, because these contains not-decided tasks.
  const { counts1, counts2 } = await TeamService.getFileTypeCounts();

  const fileTypeCounts = {};
  counts1.forEach((count) => {
    if (
      count._id.includes('RL_') ||
      count._id.includes('Recommendation_Letter_')
    ) {
      fileTypeCounts['RL'] = {
        count: (fileTypeCounts['RL']?.count || 0) + count.count
      };
    } else if (count._id.includes('Others')) {
      fileTypeCounts['OTHERS'] = {
        count: (fileTypeCounts['OTHERS']?.count || 0) + count.count
      };
    } else {
      fileTypeCounts[count._id.toUpperCase()] = {
        count: count.count
      };
    }
  });
  counts2.forEach((count) => {
    if (
      count._id.includes('RL_') ||
      count._id.includes('Recommendation_Letter_')
    ) {
      fileTypeCounts['RL'] = {
        count: (fileTypeCounts['RL']?.count || 0) + count.count
      };
    } else if (count._id.includes('Others')) {
      fileTypeCounts['OTHERS'] = {
        count: (fileTypeCounts['OTHERS']?.count || 0) + count.count
      };
    } else {
      fileTypeCounts[count._id.toUpperCase()] = {
        count: count.count
      };
    }
  });

  return fileTypeCounts;
});

const getAgentData = asyncHandler(async (req, agent) => {
  const studentQuery = {
    agents: agent._id,
    $or: [{ archiv: { $exists: false } }, { archiv: false }]
  };

  const agentStudents = await StudentService.getStudentsWithApplications(
    studentQuery
  );

  const student_num_with_offer = agentStudents.filter((std) =>
    std.applications.some((application) => application.admission === 'O')
  ).length;
  const agentData = {};
  agentData._id = agent._id.toString();
  agentData.firstname = agent.firstname;
  agentData.lastname = agent.lastname;
  agentData.student_num_no_offer =
    agentStudents.length - student_num_with_offer;
  agentData.student_num_with_offer = student_num_with_offer;
  return agentData;
});

const getAgentStudentDistData = asyncHandler(async (req, agent) =>
  TeamService.getAgentStudentDistData(agent._id)
);

const getEditorData = asyncHandler(async (req, editor) => {
  const editorData = {};
  editorData._id = editor._id.toString();
  editorData.firstname = editor.firstname;
  editorData.lastname = editor.lastname;
  editorData.student_num = await StudentService.countStudents({
    editors: editor._id,
    $or: [{ archiv: { $exists: false } }, { archiv: false }]
  });
  return editorData;
});

const getResponseIntervalByStudent = asyncHandler(async (req, res) => {
  const studentId = req.params.studentId;

  const studentApplications =
    await StudentService.getStudentApplicationsForIntervals(studentId);

  let allDocThreadId = [];
  if (studentApplications && studentApplications.applications) {
    studentApplications.applications = studentApplications.applications.map(
      (app) => ({
        programId: app.programId,
        doc_modification_thread: app.doc_modification_thread.map(
          (thread) => thread.doc_thread_id
        )
      })
    );

    allDocThreadIds = studentApplications.applications.reduce((acc, app) => {
      return acc.concat(app.doc_modification_thread);
    }, []);
  }

  const responseIntervalRecords = await TeamService.getIntervals({
    $or: [{ student_id: studentId }, { thread_id: { $in: allDocThreadIds } }]
  });

  const intervalsGroupedByThread = responseIntervalRecords.reduce(
    (acc, item) => {
      const key = item.thread_id || item.interval_type;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item);
      return acc;
    },
    {}
  );

  studentApplications.communicationThreadIntervals =
    intervalsGroupedByThread?.['communication'];

  studentApplications.applications = studentApplications.applications
    .map((application) => {
      const threadIds = application.doc_modification_thread;
      if (!threadIds) {
        return;
      }
      let intervalsByThreads = [];
      const threadIntervals = threadIds.forEach((threadId) => {
        const _id = threadId.toString();
        if (intervalsGroupedByThread.hasOwnProperty(_id)) {
          intervalsByThreads.push({
            threadId: _id,
            intervalType: intervalsGroupedByThread[_id][0].interval_type,
            intervals: intervalsGroupedByThread[_id]?.map((interval) => {
              delete interval.thread_id;
              delete interval.interval_type;
              return interval;
            })
          });
        }
      });
      if (intervalsByThreads.length === 0) {
        return;
      }
      delete application.doc_modification_thread;
      application.threadIntervals = intervalsByThreads;
      const { ['programId']: program, ...rest } = application;
      application = { ...program, ...rest };
      return application;
    })
    ?.filter((application) => !!application);

  res.status(200).send({ success: true, data: studentApplications });
});

const getResponseTimeByStudent = asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const responseTimeRecords = await TeamService.getResponseTimesByStudent(
    studentId
  );
  res.status(200).send({ success: true, data: responseTimeRecords });
});

const putAgentProfile = asyncHandler(async (req, res, next) => {
  const { agent_id } = req.params;
  const agent = await UserService.findAgentById(
    agent_id,
    'firstname lastname email selfIntroduction'
  );

  res.status(200).send({ success: true, data: agent });
});

const getAgentProfile = asyncHandler(async (req, res, next) => {
  const { agent_id } = req.params;
  const agent = await UserService.findAgentById(
    agent_id,
    'firstname lastname email selfIntroduction officehours timezone'
  );

  res.status(200).send({ success: true, data: agent });
});

const getArchivStudents = asyncHandler(async (req, res) => {
  const { TaiGerStaffId } = req.params;
  const user = await UserService.getUserById(TaiGerStaffId);
  if (user.role === Role.Admin) {
    const students = await StudentService.findStudentsWithTeamNames({
      archiv: true
    });
    res.status(200).send({ success: true, data: students });
  } else if (is_TaiGer_Agent(user)) {
    const students = await StudentService.findStudentsWithTeamNames({
      agents: TaiGerStaffId,
      archiv: true
    });

    res.status(200).send({ success: true, data: students });
  } else if (user.role === Role.Editor) {
    const students = await StudentService.findStudentsWithTeamNames({
      editors: TaiGerStaffId,
      archiv: true
    });
    res.status(200).send({ success: true, data: students });
  } else {
    // Guest
    res.status(200).send({ success: true, data: [] });
  }
});

const getTasksOverview = asyncHandler(async (req, res, next) => {
  const { filter: noAgentsfilter } = new UserQueryBuilder()
    .withArchiv(false)
    .withAgents({ $exists: true, $size: 0 })
    .build();
  const { filter: noEditorsfilter } = new UserQueryBuilder()
    .withArchiv(false)
    .withEditors({ $exists: true, $size: 0 })
    .withNeedEditor(true)
    .build();
  const { filter: noTrainerInInterviewsfilter } = new InterviewQueryBuilder()
    .withIsClosed(false)
    .withTrainerId({ $exists: true, $size: 0 })
    .build();

  const [
    noAgentsStudents,
    noEditorsStudents,
    noTrainerInInterviewsStudents,
    noEssayWritersEssays
  ] = await Promise.all([
    StudentService.fetchStudents(noAgentsfilter),
    StudentService.fetchStudents(noEditorsfilter),
    InterviewService.getInterviews(noTrainerInInterviewsfilter),
    DocumentThreadService.getAllStudentsThreads(req, {
      isFinalVersion: false,
      file_type: 'Essay',
      outsourced_user_id: { $exists: true, $size: 0 },
      messages: { $exists: true, $not: { $size: 0 } }
    })
  ]);

  res.status(200).send({
    success: true,
    data: {
      noAgentsStudents: noAgentsStudents?.length || 0,
      noEditorsStudents: noEditorsStudents?.length || 0,
      noTrainerInInterviewsStudents: noTrainerInInterviewsStudents?.length || 0,
      noEssayWritersEssays: noEssayWritersEssays?.length || 0
    }
  });
});

const getIsManager = asyncHandler(async (req, res, next) => {
  const permission = await PermissionService.getPermissionByUserId(
    req.user._id
  );

  const isManager = permission?.canAssignAgents || permission?.canAssignEditors;

  res.status(200).send({ success: true, data: { isManager } });
});

// Helper function to get editor task counts
const getEditorTaskCounts = asyncHandler(async (req, editors) => {
  // General-doc + decided-application editor task rows (computed in the DAO).
  const allTasks = await TeamService.getEditorTaskRows();

  // Group by editor and count
  const editorTaskCounts = {};

  editors.forEach((editor) => {
    const editorId = editor._id.toString();
    const editorTasks = allTasks.filter(
      (task) => task.editor_id.toString() === editorId
    );

    // Count active tasks (not final version and show = true)
    const activeTasks = editorTasks.filter(
      (task) => task.isFinalVersion !== true && task.show === true
    );

    // Count potential tasks (not final version, show = false, isPotentials = true)
    const potentialTasks = editorTasks.filter(
      (task) =>
        task.isFinalVersion !== true &&
        task.show === false &&
        task.isPotentials === true
    );

    editorTaskCounts[editorId] = {
      active: activeTasks.length,
      potentials: potentialTasks.length
    };
  });

  return editorTaskCounts;
});

// Separate statistics endpoints for each dashboard tab
const getStatisticsOverview = asyncHandler(async (req, res) => {
  const cacheKey = 'internalDashboard:overview';
  const value = ten_minutes_cache.get(cacheKey);
  if (value === undefined) {
    const activeFilter = {
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    };
    const agents = await UserService.findAgents(activeFilter);
    const editors = await UserService.findEditors(activeFilter);

    const agentsPromises = Promise.all(
      agents.map((agent) => getAgentData(req, agent))
    );
    const editorsPromises = Promise.all(
      editors.map((editor) => getEditorData(req, editor))
    );
    const documentsPromise = getFileTypeCount(req);

    // Get student data for charts (only necessary fields)
    const studentsDataPromise = TeamService.getStudentsCreationData();

    // Get editor task counts
    const editorTaskCountsPromise = getEditorTaskCounts(req, editors);

    const [
      agents_raw_data,
      editors_raw_data,
      documentsData,
      studentsData,
      editorTaskCounts
    ] = await Promise.all([
      agentsPromises,
      editorsPromises,
      documentsPromise,
      studentsDataPromise,
      editorTaskCountsPromise
    ]);

    const students_years_arr = numStudentYearDistribution(studentsData);
    const students_years = Object.keys(students_years_arr).sort();
    const lastYears = students_years.slice(
      Math.max(students_years.length - 10, 1)
    );

    const students_years_pair = lastYears.map((date) => ({
      name: `${date}`,
      uv: students_years_arr[date]
    }));

    const colors = [
      '#ff8a65',
      '#f4c22b',
      '#04a9f5',
      '#3ebfea',
      '#4F5467',
      '#1de9b6',
      '#a389d4',
      '#FE8A7D'
    ];

    const editors_data = [];
    editors_raw_data.forEach((editor, i) => {
      const editorId = editor._id.toString();
      editors_data.push({
        ...editor,
        key: `${editor.firstname}`,
        student_num: editor.student_num,
        color: colors[i],
        task_counts: editorTaskCounts[editorId] || { active: 0, potentials: 0 }
      });
    });

    const agents_data = [];
    agents_raw_data.forEach((agent, i) => {
      agents_data.push({
        ...agent,
        key: `${agent.firstname}`,
        student_num_no_offer: agent.student_num_no_offer,
        student_num_with_offer: agent.student_num_with_offer,
        color: colors[i]
      });
    });

    const returnBody = {
      success: true,
      documents: documentsData,
      agents_data,
      editors_data,
      students_years_pair,
      students_creation_dates: studentsData
    };
    res.status(200).send(returnBody);
    const success = ten_minutes_cache.set(cacheKey, returnBody);
    if (success) {
      logger.info('internal dashboard overview cache set successfully');
    }
  } else {
    logger.info('internal dashboard overview cache hit');
    res.status(200).send(value);
  }
});

const getStatisticsAgents = asyncHandler(async (req, res) => {
  const cacheKey = 'internalDashboard:agents';
  const value = ten_minutes_cache.get(cacheKey);
  if (value === undefined) {
    const agents = await UserService.findAgents({
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });

    const agentsStudentsDistribution = await Promise.all(
      agents.map((agent) => getAgentStudentDistData(req, agent))
    );

    const resultAdmission = agentsStudentsDistribution.map(
      (agentStudentDis, idx) => {
        const returnData = {
          name: `${agents[idx].firstname}`,
          id: `${agents[idx]._id.toString()}`,
          admission: agentStudentDis.admission.reduce((acc, curr) => {
            if (curr.expected_application_date) {
              acc[curr.expected_application_date] = curr.count;
            } else {
              acc.TBD = curr.count;
            }
            return acc;
          }, {})
        };
        return returnData;
      }
    );

    const resultNoAdmission = agentsStudentsDistribution.map(
      (agentStudentDis, idx) => {
        const returnData = {
          noAdmission: agentStudentDis.noAdmission.reduce((acc, curr) => {
            if (curr.expected_application_date) {
              acc[curr.expected_application_date] = curr.count;
            } else {
              acc.TBD = curr.count;
            }
            return acc;
          }, {})
        };
        return returnData;
      }
    );
    const mergedResults = _.mergeWith(resultAdmission, resultNoAdmission);

    const returnBody = {
      success: true,
      agentStudentDistribution: mergedResults
    };
    res.status(200).send(returnBody);
    const success = ten_minutes_cache.set(cacheKey, returnBody);
    if (success) {
      logger.info('internal dashboard agents cache set successfully');
    }
  } else {
    logger.info('internal dashboard agents cache hit');
    res.status(200).send(value);
  }
});

const getStatisticsKPI = asyncHandler(async (req, res) => {
  const cacheKey = 'internalDashboard:kpi';
  const value = ten_minutes_cache.get(cacheKey);
  if (value === undefined) {
    const finishedDocs = await TeamService.getKpiFinishedDocs();

    const returnBody = {
      success: true,
      finished_docs: finishedDocs
    };
    res.status(200).send(returnBody);
    const success = ten_minutes_cache.set(cacheKey, returnBody);
    if (success) {
      logger.info('internal dashboard kpi cache set successfully');
    }
  } else {
    logger.info('internal dashboard kpi cache hit');
    res.status(200).send(value);
  }
});

const getStatisticsResponseTime = asyncHandler(async (req, res) => {
  const cacheKey = 'internalDashboard:responseTime';
  const value = ten_minutes_cache.get(cacheKey);
  if (value === undefined) {
    const activeFilter = {
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    };
    const agents = await UserService.findAgents(activeFilter);
    const editors = await UserService.findEditors(activeFilter);

    const agentsPromises = Promise.all(
      agents.map((agent) => getAgentData(req, agent))
    );
    const editorsPromises = Promise.all(
      editors.map((editor) => getEditorData(req, editor))
    );

    const studentAvgResponseTimePromise =
      TeamService.getStudentAvgResponseTime();

    const [agents_raw_data, editors_raw_data, studentAvgResponseTime] =
      await Promise.all([
        agentsPromises,
        editorsPromises,
        studentAvgResponseTimePromise
      ]);

    const colors = [
      '#ff8a65',
      '#f4c22b',
      '#04a9f5',
      '#3ebfea',
      '#4F5467',
      '#1de9b6',
      '#a389d4',
      '#FE8A7D'
    ];

    const editors_data = [];
    editors_raw_data.forEach((editor, i) => {
      editors_data.push({
        ...editor,
        key: `${editor.firstname}`,
        student_num: editor.student_num,
        color: colors[i]
      });
    });

    const agents_data = [];
    agents_raw_data.forEach((agent, i) => {
      agents_data.push({
        ...agent,
        key: `${agent.firstname}`,
        student_num_no_offer: agent.student_num_no_offer,
        student_num_with_offer: agent.student_num_with_offer,
        color: colors[i]
      });
    });

    const returnBody = {
      success: true,
      agents_data,
      editors_data,
      studentAvgResponseTime
    };
    res.status(200).send(returnBody);
    const success = ten_minutes_cache.set(cacheKey, returnBody);
    if (success) {
      logger.info('internal dashboard response time cache set successfully');
    }
  } else {
    logger.info('internal dashboard response time cache hit');
    res.status(200).send(value);
  }
});

module.exports = {
  getTeamMembers,
  getStatisticsOverview,
  getStatisticsAgents,
  getStatisticsKPI,
  getStatisticsResponseTime,
  getResponseIntervalByStudent,
  getResponseTimeByStudent,
  putAgentProfile,
  getAgentProfile,
  getArchivStudents,
  getApplicationDeltas,
  getTasksOverview,
  getIsManager
};
