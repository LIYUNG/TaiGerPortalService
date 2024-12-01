const _ = require('lodash');
const { is_TaiGer_Agent } = require('@taiger-common/core');

const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const { Role } = require('../constants');
const logger = require('../services/logger');
const { getStudentsByProgram } = require('./programs');
const { findStudentDeltaGet } = require('../utils/modelHelper/programChange');
const { getPermission } = require('../utils/queryFunctions');
const { GenerateResponseTimeByStudent } = require('./response_time');
const { numStudentYearDistribution } = require('../utils/utils_function');
const { one_day_cache } = require('../cache/node-cache');

const getActivePrograms = asyncHandler(async (req) => {
  const activePrograms = await req.db.model('User').aggregate([
    {
      $match: {
        role: 'Student',
        archiv: {
          $ne: true
        }
      }
    },
    {
      $project: {
        applications: 1
      }
    },
    {
      $unwind: {
        path: '$applications'
      }
    },
    {
      $match: {
        'applications.decided': 'O',
        'applications.closed': '-'
      }
    },
    {
      $group: {
        _id: '$applications.programId',
        count: {
          $sum: 1
        }
      }
    },
    {
      $sort: {
        count: -1
      }
    }
  ]);

  return activePrograms;
});

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
  const program = await req.db.model('Program').findById(programId);
  const studentDeltaPromises = [];
  const options = { skipCompleted: true };
  for (const student of students) {
    if (!student.application || student.application.closed !== '-') {
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
  const users = await req.db.model('User').aggregate([
    {
      $match: {
        role: { $in: ['Admin', 'Agent', 'Editor'] },
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
  res.status(200).send({ success: true, data: users });
});

const getGeneralTasks = asyncHandler(async (req) => {
  const studentsWithCommunications = await req.db.model('Student').aggregate([
    // Match students where archiv is not true
    { $match: { $or: [{ archiv: { $exists: false } }, { archiv: false }] } },
    // Unwind the generaldocs_threads array to create a document for each application
    { $unwind: '$generaldocs_threads' },
    // Lookup to join the Documentthread collection
    {
      $lookup: {
        from: 'documentthreads', // the collection name of Documentthread
        localField: 'generaldocs_threads.doc_thread_id',
        foreignField: '_id',
        as: 'doc_thread'
      }
    },
    // Unwind the doc_thread array to get the document object instead of an array
    { $unwind: '$doc_thread' },
    // Project to reshape the output
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
  return studentsWithCommunications;
});

const getDecidedApplicationsTasks = asyncHandler(async (req) => {
  const studentsWithCommunications = await req.db.model('Student').aggregate([
    // Match students where archiv is not true
    { $match: { $or: [{ archiv: { $exists: false } }, { archiv: false }] } },
    // Unwind the applications array to create a document for each application
    { $unwind: '$applications' },
    // Match applications where the decided field is 'O'
    { $match: { 'applications.decided': 'O' } },
    // Unwind the doc_modification_thread array within each application
    { $unwind: '$applications.doc_modification_thread' },
    // Lookup to join the Documentthread collection
    {
      $lookup: {
        from: 'documentthreads', // the collection name of Documentthread
        localField: 'applications.doc_modification_thread.doc_thread_id',
        foreignField: '_id',
        as: 'doc_thread'
      }
    },
    // Unwind the doc_thread array to get the document object instead of an array
    { $unwind: '$doc_thread' },
    // Lookup to join the Program collection for programId
    {
      $lookup: {
        from: 'programs', // Assuming this is the collection name for Program documents
        localField: 'applications.programId',
        foreignField: '_id',
        as: 'program'
      }
    },
    // Unwind the program array to get the program object instead of an array
    { $unwind: '$program' },
    // Project to reshape the output
    {
      $project: {
        isFinalVersion: '$applications.doc_modification_thread.isFinalVersion',
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
        application_year: '$application_preference.expected_application_date'
      }
    }
  ]);
  return studentsWithCommunications;
});

const getFileTypeCount = asyncHandler(async (req) => {
  // TODO not accurate, because these contains not-decided tasks.

  const counts1Promise = req.db.model('Student').aggregate([
    // Match students where archiv is not true
    { $match: { $or: [{ archiv: { $exists: false } }, { archiv: false }] } },
    // Unwind the generaldocs_threads array to create a document for each application
    { $unwind: '$generaldocs_threads' },
    // Lookup to join the Documentthread collection
    {
      $lookup: {
        from: 'documentthreads', // the collection name of Documentthread
        localField: 'generaldocs_threads.doc_thread_id',
        foreignField: '_id',
        as: 'doc_thread'
      }
    },
    // Unwind the doc_thread array to get the document object instead of an array
    { $unwind: '$doc_thread' },
    { $group: { _id: '$doc_thread.file_type', count: { $sum: 1 } } }
  ]);
  const counts2Promise = req.db.model('Student').aggregate([
    // Match students where archiv is not true
    { $match: { $or: [{ archiv: { $exists: false } }, { archiv: false }] } },
    // Unwind the applications array to create a document for each application
    { $unwind: '$applications' },
    // Match applications where the decided field is 'O'
    { $match: { 'applications.decided': 'O' } },
    // Unwind the doc_modification_thread array within each application
    { $unwind: '$applications.doc_modification_thread' },
    // Lookup to join the Documentthread collection
    {
      $lookup: {
        from: 'documentthreads', // the collection name of Documentthread
        localField: 'applications.doc_modification_thread.doc_thread_id',
        foreignField: '_id',
        as: 'doc_thread'
      }
    },
    // Unwind the doc_thread array to get the document object instead of an array
    { $unwind: '$doc_thread' },
    { $group: { _id: '$doc_thread.file_type', count: { $sum: 1 } } }
  ]);

  const [counts1, counts2] = await Promise.all([
    counts1Promise,
    counts2Promise
  ]);

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
  const agentStudents = await req.db
    .model('Student')
    .find({
      agents: agent._id,
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    })
    .lean();
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

const getAgentStudentDistData = asyncHandler(async (req, agent) => {
  const studentYearDistributionPromise = req.db.model('Student').aggregate([
    {
      $match: {
        archiv: { $ne: true },
        agents: agent._id, // Filter students where agents array includes the specific ObjectId
        'applications.admission': 'O'
      }
    },
    {
      $group: {
        _id: {
          expected_application_date:
            '$application_preference.expected_application_date'
        },
        count: { $sum: 1 } // Count the number of students in each group
      }
    },
    {
      $project: {
        _id: 0, // Do not include the default _id field
        expected_application_date: '$_id.expected_application_date', // Rename _id.expected_application_date to expected_application_date
        count: 1 // Include the count field
      }
    },
    {
      $sort: { expected_application_date: 1 } // Sort by expected_application_date in ascending order
    }
  ]);

  const studentYearNoAdmissionDistributionPromise = req.db
    .model('Student')
    .aggregate([
      {
        $match: {
          archiv: { $ne: true },
          agents: agent._id, // Filter students where agents array includes the specific ObjectId
          'applications.admission': { $ne: 'O' }
        }
      },
      {
        $group: {
          _id: {
            expected_application_date:
              '$application_preference.expected_application_date'
          },
          count: { $sum: 1 } // Count the number of students in each group
        }
      },
      {
        $project: {
          _id: 0, // Do not include the default _id field
          expected_application_date: '$_id.expected_application_date', // Rename _id.expected_application_date to expected_application_date
          count: 1 // Include the count field
        }
      },
      {
        $sort: { expected_application_date: 1 } // Sort by expected_application_date in ascending order
      }
    ]);
  const [studentYearDistribution, studentYearNoAdmissionDistribution] =
    await Promise.all([
      studentYearDistributionPromise,
      studentYearNoAdmissionDistributionPromise
    ]);

  return {
    admission: studentYearDistribution,
    noAdmission: studentYearNoAdmissionDistribution
  };
});

const getEditorData = asyncHandler(async (req, editor) => {
  const editorData = {};
  editorData._id = editor._id.toString();
  editorData.firstname = editor.firstname;
  editorData.lastname = editor.lastname;
  editorData.student_num = await req.db
    .model('Student')
    .find({
      editors: editor._id,
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    })
    .count();
  return editorData;
});

const getStatistics = asyncHandler(async (req, res) => {
  const cacheKey = 'internalDashboard';
  const value = one_day_cache.get(cacheKey);
  if (value === undefined) {
    const agents = await req.db.model('Agent').find({
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });
    const editors = await req.db.model('Editor').find({
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });

    const agentsPromises = Promise.all(
      agents.map((agent) => getAgentData(req, agent))
    );
    const editorsPromises = Promise.all(
      editors.map((editor) => getEditorData(req, editor))
    );

    const documentsPromise = getFileTypeCount(req);
    const finDocsPromise = req.db
      .model('Documentthread')
      .find({
        isFinalVersion: true,
        $or: [
          { file_type: 'CV' },
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

    const studentsPromise = req.db
      .model('Student')
      .find()
      .select(
        'firstname lastname applications application_preference generaldocs_threads editors agents createdAt'
      )
      .populate('agents editors', 'firstname lastname')
      .populate('applications.programId')
      .populate(
        'generaldocs_threads.doc_thread_id applications.doc_modification_thread.doc_thread_id',
        '-messages'
      )
      .lean();

    const archivCountPromise = req.db.model('Student').aggregate([
      {
        $group: {
          _id: '$archiv',
          count: { $sum: 1 }
        }
      }
    ]);
    // TODO: get MLs, RLs, etc. individual response time and thread_id>> will be used to query intervals collection.
    // const studentResponseTimeLookupTablePromise =
    //   GenerateResponseTimeByStudent();

    const studentAvgResponseTimePipeline = [
      // group by student and document type and calculate the average response time per document type
      {
        $group: {
          _id: {
            student_id: '$student_id',
            interval_type: '$interval_type'
          },
          typeAvg: { $avg: '$intervalAvg' }
        }
      },
      // unwrap the _id object -> which is used for grouping (student_id, interval_type)
      {
        $replaceRoot: { newRoot: { $mergeObjects: ['$_id', '$$ROOT'] } }
      },
      // group by student to create a array of all averages per document type
      {
        $group: {
          _id: '$student_id',
          avgByType: {
            $push: {
              k: '$interval_type',
              v: '$typeAvg'
            }
          }
        }
      },
      // lookup student details (name, agents, editors)
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'student'
        }
      },
      // unwrap the student data, spreading the details to the root level
      {
        $unwind: '$student'
      },
      // select only the relevant fields for the output
      {
        $project: {
          _id: 1,
          agents: '$student.agents',
          editors: '$student.editors',
          lastname_chinese: '$student.lastname_chinese',
          firstname_chinese: '$student.firstname_chinese',
          name: {
            $concat: ['$student.firstname', ' ', '$student.lastname']
          },
          avgByType: {
            $arrayToObject: '$avgByType'
          }
        }
      }
    ];

    const studentAvgResponseTimePromise = req.db
      .model('ResponseTime')
      .aggregate(studentAvgResponseTimePipeline);
    const activeStudentGeneralTasksPromise = getGeneralTasks(req);
    const activeStudentTasksPromise = getDecidedApplicationsTasks(req);

    const programListStatsPipeline = [
      {
        $facet: {
          countryCount: [
            { $group: { _id: '$country', count: { $sum: 1 } } },
            { $project: { _id: 0, country: '$_id', count: 1 } }
          ],
          whoupdatedCount: [
            { $group: { _id: '$whoupdated', count: { $sum: 1 } } },
            { $project: { _id: 0, whoupdated: '$_id', count: 1 } }
          ],
          schoolCount: [
            { $group: { _id: '$school', count: { $sum: 1 } } },
            { $project: { _id: 0, school: '$_id', count: 1 } }
          ],
          langCount: [
            { $group: { _id: '$lang', count: { $sum: 1 } } },
            { $project: { _id: 0, lang: '$_id', count: 1 } }
          ],
          degreeCount: [
            { $group: { _id: '$degree', count: { $sum: 1 } } },
            { $project: { _id: 0, degree: '$_id', count: 1 } }
          ],
          updatedAtCount: [
            {
              $group: {
                _id: {
                  $dateToString: { format: '%Y-%m-%d', date: '$updatedAt' }
                },
                count: { $sum: 1 }
              }
            },
            { $project: { _id: 0, updatedAt: '$_id', count: 1 } },
            { $sort: { updatedAt: 1 } }
          ]
        }
      }
    ];

    const programListStatsPromise = req.db
      .model('Program')
      .aggregate(programListStatsPipeline);

    const [
      agents_raw_data,
      editors_raw_data,
      documentsData,
      finishedDocs,
      students,
      archivCount,
      studentAvgResponseTime,
      activeStudentGeneralTasks,
      activeStudentTasks,
      programListStats,
      ...agentsStudentsDistribution
    ] = await Promise.all([
      agentsPromises,
      editorsPromises,
      documentsPromise,
      finDocsPromise,
      studentsPromise,
      archivCountPromise,
      studentAvgResponseTimePromise,
      activeStudentGeneralTasksPromise,
      activeStudentTasksPromise,
      programListStatsPromise,
      ...agents.map((agent) => getAgentStudentDistData(req, agent))
    ]);

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
    const students_years_arr = numStudentYearDistribution(students);
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
      documents: documentsData,
      students: {
        isClose: archivCount.find((count) => count._id === true)?.count || 0,
        isOpen: archivCount.find((count) => count._id === false)?.count || 0
      },
      finished_docs: finishedDocs,
      agents_data,
      editors_data,
      students_years_pair,
      students_details: students,
      applications: [],
      activeStudentGeneralTasks,
      activeStudentTasks,
      agentStudentDistribution: mergedResults,
      programListStats: programListStats?.[0], // unwrap single element pipeline
      studentAvgResponseTime
    };
    res.status(200).send(returnBody);
    const success = one_day_cache.set(cacheKey, returnBody);
    if (success) {
      logger.info('internal dashboard cache set successfully');
    }
  } else {
    logger.info('internal dashboard cache hit');
    res.status(200).send(value);
  }
});

const getAgents = asyncHandler(async (req, res, next) => {
  const { user } = req;
  if (user.role === 'Agent') {
    const permissions = await getPermission(req, user);
    if (permissions && permissions.canAssignAgents) {
      const agents = await req.db
        .model('Agent')
        .find({
          $or: [{ archiv: { $exists: false } }, { archiv: false }]
        })
        .select('firstname lastname');
      res.status(200).send({ success: true, data: agents });
    } else {
      logger.error('getAgents: no permission');
      throw new ErrorResponse(
        403,
        'You do not have the permission to do this action'
      );
    }
  } else {
    const agents = await req.db
      .model('Agent')
      .find({
        $or: [{ archiv: { $exists: false } }, { archiv: false }]
      })
      .select('firstname lastname');
    res.status(200).send({ success: true, data: agents });
  }
});

const getSingleAgent = asyncHandler(async (req, res, next) => {
  const { agent_id } = req.params;

  const agentPromise = req.db
    .model('Agent')
    .findById(agent_id)
    .select('firstname lastname');
  // query by agents field: student.agents include agent_id
  const studentsPromise = req.db
    .model('Student')
    .find({
      agents: agent_id,
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    })
    .populate('agents editors', 'firstname lastname email')
    .populate('applications.programId')
    .populate(
      'generaldocs_threads.doc_thread_id applications.doc_modification_thread.doc_thread_id',
      '-messages'
    )
    .select('-notification')
    .lean()
    .exec();

  const [agent, students] = await Promise.all([agentPromise, studentsPromise]);

  res.status(200).send({ success: true, data: { students, agent } });
});

const putAgentProfile = asyncHandler(async (req, res, next) => {
  const { agent_id } = req.params;
  const agent = await req.db
    .model('Agent')
    .findById(agent_id)
    .select('firstname lastname email selfIntroduction');

  res.status(200).send({ success: true, data: agent });
});

const getAgentProfile = asyncHandler(async (req, res, next) => {
  const { agent_id } = req.params;
  const agent = await req.db
    .model('Agent')
    .findById(agent_id)
    .select('firstname lastname email selfIntroduction officehours timezone');

  res.status(200).send({ success: true, data: agent });
});

const getEditors = asyncHandler(async (req, res, next) => {
  const { user } = req;
  if (user.role === Role.Editor) {
    const permissions = await getPermission(req, user);
    if (permissions && permissions.canAssignEditors) {
      const editors = await req.db
        .model('Editor')
        .find({
          $or: [{ archiv: { $exists: false } }, { archiv: false }]
        })
        .select('firstname lastname');
      res.status(200).send({ success: true, data: editors });
    } else {
      logger.error('getEditors: no permission');
      throw new ErrorResponse(
        403,
        'You do not have the permission to do this action'
      );
    }
  } else {
    const editors = await req.db
      .model('Editor')
      .find({
        $or: [{ archiv: { $exists: false } }, { archiv: false }]
      })
      .select('firstname lastname');
    res.status(200).send({ success: true, data: editors });
  }
});

const getSingleEditor = asyncHandler(async (req, res, next) => {
  const { editor_id } = req.params;
  const editorPromise = req.db
    .model('Editor')
    .findById(editor_id)
    .select('firstname lastname');
  // query by agents field: student.editors include editor_id
  const studentsPromise = req.db
    .model('Student')
    .find({
      editors: editor_id,
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    })
    .populate('agents editors', 'firstname lastname email')
    .populate('applications.programId')
    .populate({
      path: 'generaldocs_threads.doc_thread_id',
      select: 'file_type isFinalVersion updatedAt',
      populate: {
        path: 'messages.user_id',
        select: 'firstname lastname'
      }
    })
    .populate({
      path: 'applications.doc_modification_thread.doc_thread_id',
      select: 'file_type isFinalVersion updatedAt',
      populate: {
        path: 'messages.user_id',
        select: 'firstname lastname'
      }
    })
    .select('-notification');

  const [editor, students] = await Promise.all([
    editorPromise,
    studentsPromise
  ]);
  res.status(200).send({ success: true, data: { students, editor } });
});

const getArchivStudents = asyncHandler(async (req, res) => {
  const { TaiGerStaffId } = req.params;
  const user = await req.db.model('User').findById(TaiGerStaffId);
  if (user.role === Role.Admin) {
    const students = await req.db
      .model('Student')
      .find({ archiv: true })
      .populate('agents editors', 'firstname lastname')
      .exec();
    res.status(200).send({ success: true, data: students });
  } else if (is_TaiGer_Agent(user)) {
    const students = await req.db
      .model('Student')
      .find({
        agents: TaiGerStaffId,
        archiv: true
      })
      .populate('agents editors', 'firstname lastname')
      .populate('applications.programId')
      .lean()
      .exec();

    res.status(200).send({ success: true, data: students });
  } else if (user.role === Role.Editor) {
    const students = await req.db
      .model('Student')
      .find({
        editors: TaiGerStaffId,
        archiv: true
      })
      .populate('agents editors', 'firstname lastname')
      .populate('applications.programId');
    res.status(200).send({ success: true, data: students });
  } else {
    // Guest
    res.status(200).send({ success: true, data: [] });
  }
});

const getEssayWriters = asyncHandler(async (req, res, next) => {
  const { user } = req;
  if (user.role === 'Editor') {
    const permissions = await getPermission(req, user);
    // if (permissions && permissions.canAssignEditors && permissions.isEssayWriters) {
    if (permissions && permissions.canAssignEditors) {
      const editors = await req.db
        .model('Editor')
        .find({
          $or: [{ archiv: { $exists: false } }, { archiv: false }]
        })
        .select('firstname lastname');
      res.status(200).send({ success: true, data: editors });
    } else {
      logger.error('getEssayWriters: no permission');
      throw new ErrorResponse(
        403,
        'You do not have the permission to do this action'
      );
    }
  } else {
    const editors = await req.db
      .model('Editor')
      .find({
        $or: [{ archiv: { $exists: false } }, { archiv: false }]
      })
      .select('firstname lastname');
    res.status(200).send({ success: true, data: editors });
  }
});

module.exports = {
  getTeamMembers,
  getStatistics,
  getAgents,
  getSingleAgent,
  putAgentProfile,
  getAgentProfile,
  getEditors,
  getSingleEditor,
  getArchivStudents,
  getEssayWriters,
  getApplicationDeltas
};
