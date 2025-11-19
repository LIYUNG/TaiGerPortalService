const {
  Role,
  is_TaiGer_Agent,
  is_TaiGer_Editor,
  is_TaiGer_External,
  is_TaiGer_Student,
  is_TaiGer_Admin
} = require('@taiger-common/core');
const mongoose = require('mongoose');

const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const {
  add_portals_registered_status,
  userChangesHelperFunction
} = require('../utils/utils_function');
const logger = require('../services/logger');
const {
  informEditorArchivedStudentEmail,
  informStudentArchivedStudentEmail,
  informAgentNewStudentEmail,
  informStudentTheirAgentEmail,
  informEditorNewStudentEmail,
  informStudentTheirEditorEmail,
  informAgentStudentAssignedEmail,
  informAgentManagerNewStudentEmail
} = require('../services/email');

const { isNotArchiv, ManagerType } = require('../constants');
const { getPermission } = require('../utils/queryFunctions');
const StudentService = require('../services/students');
const UserQueryBuilder = require('../builders/UserQueryBuilder');
const ApplicationService = require('../services/applications');
const InterviewService = require('../services/interviews');
const { getAuditLogs } = require('../services/audit');

const getStudentAndDocLinks = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { studentId }
  } = req;
  const applicationsPromise = ApplicationService.getApplicationsByStudentId(
    req,
    studentId
  );

  const studentPromise = req.db
    .model('Student')
    .findById(studentId)
    .populate('agents editors', 'firstname lastname email pictureUrl')
    .populate({
      path: 'generaldocs_threads.doc_thread_id',
      select: 'file_type isFinalVersion updatedAt messages.file',
      populate: {
        path: 'messages.user_id',
        select: 'firstname lastname pictureUrl'
      }
    })
    .select('-taigerai')
    .lean();

  const base_docs_linkPromise = req.db.model('Basedocumentationslink').find({
    category: 'base-documents'
  });
  const survey_linkPromise = req.db.model('Basedocumentationslink').find({
    category: 'survey'
  });
  const auditPromise = getAuditLogs(
    req,
    {
      targetUserId: studentId
    },
    {
      limit: 1000,
      sort: { createdAt: -1 }
    }
  );
  const [student, applications, base_docs_link, survey_link, audit] =
    await Promise.all([
      studentPromise,
      applicationsPromise,
      base_docs_linkPromise,
      survey_linkPromise,
      auditPromise
    ]);
  if (!student) {
    return res
      .status(404)
      .send({ success: false, message: 'Student not found' });
  }
  // TODO: remove agent notfication for new documents upload
  student.applications = add_portals_registered_status(applications);

  res.status(200).send({
    success: true,
    data: student,
    base_docs_link,
    survey_link,
    audit
  });
  if (is_TaiGer_Agent(user)) {
    await req.db.model('Agent').findByIdAndUpdate(
      user._id.toString(),
      {
        $pull: {
          'agent_notification.isRead_new_base_docs_uploaded': {
            student_id: studentId
          }
        }
      },
      {}
    );
  }
  next();
});

const updateDocumentationHelperLink = asyncHandler(async (req, res, next) => {
  const { link, key, category } = req.body;
  // if not in database, then create one
  // otherwise: update the existing one.
  await req.db.model('Basedocumentationslink').findOneAndUpdate(
    { category, key },
    {
      $set: {
        link,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );

  const updated_helper_link = await req.db
    .model('Basedocumentationslink')
    .find({
      category
    });
  res.status(200).send({ success: true, helper_link: updated_helper_link });
  next();
});

const getActiveStudents = asyncHandler(async (req, res, next) => {
  const { editors, agents, archiv } = req.query;
  const { filter } = new UserQueryBuilder()
    .withEditors(editors ? new mongoose.Types.ObjectId(editors) : null)
    .withAgents(agents ? new mongoose.Types.ObjectId(agents) : null)
    .withArchiv(archiv)
    .build();

  const students = await StudentService.getStudentsWithApplications(
    req,
    filter
  );
  res.status(200).send({ success: true, data: students });
  next();
});

const getStudentsByIds = asyncHandler(async (req, res, next) => {
  const { ids } = req.query;
  if (!ids || typeof ids !== 'string' || ids.trim() === '') {
    return res
      .status(400)
      .send({ success: false, message: 'Missing or invalid ids parameter.' });
  }

  const { validObjectIds, invalidIds } = ids.split(',').reduce(
    (acc, rawId) => {
      const trimmedId = rawId?.trim();
      if (!trimmedId) {
        return acc;
      }

      if (!mongoose.Types.ObjectId.isValid(trimmedId)) {
        acc.invalidIds.push(trimmedId);
        return acc;
      }

      try {
        acc.validObjectIds.push(
          mongoose.Types.ObjectId.createFromHexString(trimmedId)
        );
      } catch (error) {
        acc.invalidIds.push(trimmedId);
      }

      return acc;
    },
    { validObjectIds: [], invalidIds: [] }
  );

  if (validObjectIds.length === 0) {
    return res.status(400).send({
      success: false,
      message: 'No valid student ids were provided.',
      invalidIds
    });
  }

  if (invalidIds.length > 0) {
    logger.warn('Some student ids were ignored because they are invalid.', {
      invalidIds,
      requestId: req.requestId
    });
  }

  const students = await StudentService.getStudentsWithApplications(req, {
    _id: { $in: validObjectIds }
  });

  const responsePayload = {
    success: true,
    data: students
  };

  if (invalidIds.length > 0) {
    responsePayload.message =
      'Some ids were ignored because they are not valid Mongo ObjectIds.';
    responsePayload.invalidIds = invalidIds;
  }

  res.status(200).send(responsePayload);
  next();
});

const getStudentsV3 = asyncHandler(async (req, res, next) => {
  const { editors, agents, archiv } = req.query;
  const { filter } = new UserQueryBuilder()
    .withEditors(editors)
    .withAgents(agents)
    .withArchiv(archiv)
    .build();

  const students = await StudentService.fetchStudents(req, filter);

  res.status(200).send({ success: true, data: students });
  next();
});

const getStudents = asyncHandler(async (req, res, next) => {
  const { user } = req;

  if (user.role === Role.Admin) {
    const studentsPromise = StudentService.fetchStudents(req, {
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });
    const auditLogPromise = req.db
      .model('Audit')
      .find()
      .populate(
        'performedBy targetUserId',
        'firstname lastname role pictureUrl'
      )
      .populate({
        path: 'targetDocumentThreadId interviewThreadId',
        select: 'program_id file_type',
        populate: {
          path: 'program_id',
          select: 'school program_name degree semester'
        }
      })
      .limit(20)
      .sort({ createdAt: -1 });
    const coursesPromise = req.db
      .model('Course')
      .find()
      .select('-table_data_string')
      .lean();
    const [students, courses, auditLog] = await Promise.all([
      studentsPromise,
      coursesPromise,
      auditLogPromise
    ]);
    // Perform the join
    const studentsWithCourse = students.map((student) => {
      const matchingItemB = courses.find(
        (course) => student._id.toString() === course.student_id.toString()
      );
      if (matchingItemB) {
        return { ...student, courses: matchingItemB };
      } else {
        return { ...student };
      }
    });
    const students_new = [];
    for (let j = 0; j < studentsWithCourse.length; j += 1) {
      students_new.push(add_portals_registered_status(studentsWithCourse[j]));
    }
    res.status(200).send({ success: true, data: students_new, auditLog });
  } else if (user.role === Role.Manager) {
    let students = [];
    // TODO: depends on manager type
    if (user.manager_type === ManagerType.Agent) {
      students = await StudentService.fetchStudents(req, {
        agents: { $in: user.agents },
        $or: [{ archiv: { $exists: false } }, { archiv: false }]
      });
    }
    if (user.manager_type === ManagerType.Editor) {
      students = await StudentService.fetchStudents(req, {
        editors: { $in: user.editors },
        $or: [{ archiv: { $exists: false } }, { archiv: false }]
      });
    }
    if (user.manager_type === ManagerType.AgentAndEditor) {
      students = await StudentService.fetchStudents(req, {
        $and: [
          {
            $or: [
              { agents: { $in: user.agents } },
              { editors: { $in: user.editors } }
            ]
          },
          { $or: [{ archiv: { $exists: false } }, { archiv: false }] }
        ]
      });
    }
    const courses = await req.db
      .model('Course')
      .find()
      .select('-table_data_string')
      .lean();
    // Perform the join
    const studentsWithCourse = students.map((student) => {
      const matchingItemB = courses.find(
        (course) => student._id.toString() === course.student_id.toString()
      );
      if (matchingItemB) {
        return { ...student, courses: matchingItemB };
      } else {
        return { ...student };
      }
    });
    const students_new = [];
    for (let j = 0; j < studentsWithCourse.length; j += 1) {
      students_new.push(add_portals_registered_status(studentsWithCourse[j]));
    }
    res.status(200).send({
      success: true,
      data: students_new,
      notification: user.agent_notification
    });
  } else if (is_TaiGer_Agent(user)) {
    const studentsPromise = StudentService.fetchStudents(req, {
      agents: user._id,
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });
    const coursesPromise = req.db
      .model('Course')
      .find()
      .select('-table_data_string')
      .lean();

    const [students, courses] = await Promise.all([
      studentsPromise,
      coursesPromise
    ]);

    // TODO: only my students
    // const auditLog = await req.db
    //   .model('Audit')
    //   .find({ student_id: { $in: students.map((std) => std._id) } })
    //   .populate('performedBy targetUserId', 'firstname lastname role')
    //   .populate({
    //     path: 'targetDocumentThreadId interviewThreadId',
    //     select: 'program_id file_type',
    //     populate: {
    //       path: 'program_id',
    //       select: 'school program_name degree semester'
    //     }
    //   })
    //   .limit(20)
    //   .sort({ createdAt: -1 });

    // Perform the join
    const studentsWithCourse = students.map((student) => {
      const matchingItemB = courses.find(
        (course) => student._id.toString() === course.student_id.toString()
      );
      if (matchingItemB) {
        return { ...student, courses: matchingItemB };
      } else {
        return { ...student };
      }
    });
    const students_new = [];
    for (let j = 0; j < studentsWithCourse.length; j += 1) {
      students_new.push(add_portals_registered_status(studentsWithCourse[j]));
    }
    res.status(200).send({
      success: true,
      data: students_new,
      // auditLog,
      notification: user.agent_notification
    });
  } else if (is_TaiGer_Editor(user)) {
    const permissions = await getPermission(req, user);
    if (permissions && permissions.canAssignEditors) {
      const students = await StudentService.fetchStudents(req, {
        $or: [{ archiv: { $exists: false } }, { archiv: false }]
      });

      res.status(200).send({ success: true, data: students });
    } else {
      const students = await StudentService.fetchStudents(req, {
        editors: user._id,
        $or: [{ archiv: { $exists: false } }, { archiv: false }]
      });

      res.status(200).send({ success: true, data: students });
    }
  } else if (is_TaiGer_External(user)) {
    res.status(200).send({ success: true, data: [] });
  } else if (is_TaiGer_Student(user)) {
    const studentPromise = StudentService.fetchSimpleStudents(req, {
      _id: user._id.toString()
    });

    const applicationsPromise = ApplicationService.getApplicationsByStudentId(
      req,
      user._id.toString()
    );

    const interviewsPromise = InterviewService.getInterviewsByStudentId(
      req,
      user._id.toString()
    );

    const [student, applications, interviews] = await Promise.all([
      studentPromise,
      applicationsPromise,
      interviewsPromise
    ]);

    if (interviews) {
      for (let i = 0; i < applications?.length; i += 1) {
        if (
          interviews.some(
            (interview) =>
              interview.program_id.toString() ===
              applications[i].programId._id.toString()
          )
        ) {
          const interview_temp = interviews.find(
            (interview) =>
              interview.program_id.toString() ===
              applications[i].programId._id.toString()
          );
          applications[i].interview_status = interview_temp.status;
          applications[i].interview_trainer_id = interview_temp.trainer_id;
          applications[i].interview_training_event = interview_temp.event_id;
          applications[i].interview_id = interview_temp._id.toString();
        }
      }
    }
    const student_new = add_portals_registered_status(student);
    // TODO Get My Courses
    let isCoursesFilled = true;
    const courses = await req.db
      .model('Course')
      .findOne({
        student_id: user._id.toString()
      })
      .lean();
    if (!courses) {
      isCoursesFilled = false;
    }
    res
      .status(200)
      .send({ success: true, data: [student_new], isCoursesFilled });
  } else {
    // Guest
    res.status(200).send({ success: true, data: [user] });
  }
  next();
});

const getStudentsAndDocLinks = asyncHandler(async (req, res, next) => {
  const { user } = req;
  const { editors, agents, archiv } = req.query;
  const { filter } = new UserQueryBuilder()
    .withEditors(editors)
    .withAgents(agents)
    .withArchiv(archiv)
    .build();

  if (
    is_TaiGer_Admin(user) ||
    is_TaiGer_Agent(user) ||
    is_TaiGer_Editor(user)
  ) {
    const students = await StudentService.fetchSimpleStudents(req, filter);
    res.status(200).send({ success: true, data: students, base_docs_link: {} });
  } else if (is_TaiGer_Student(user)) {
    const obj = user.notification; // create object
    obj['isRead_base_documents_rejected'] = true; // set value
    const student = await StudentService.updateStudentById(
      req,
      user._id.toString(),
      {
        notification: obj
      }
    );

    const base_docs_link = await req.db.model('Basedocumentationslink').find({
      category: 'base-documents'
    });
    res.status(200).send({ success: true, data: [student], base_docs_link });
  } else {
    // Guest
    res.status(200).send({ success: true, data: [user] });
  }
  next();
});

// () TODO email : agent better notification! (only added or removed should be informed.)
// (O) email : inform student close service
// (O) email : inform editor that student is archived.
const updateStudentsArchivStatus = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { studentId },
    body: { isArchived, shouldInform }
  } = req;

  // TODO: data validation for isArchived and studentId
  const student = await StudentService.updateStudentById(req, studentId, {
    archiv: isArchived
  });

  if (isArchived) {
    // return dashboard students
    if (user.role === Role.Admin) {
      const students = await StudentService.fetchStudents(req, {
        $or: [{ archiv: { $exists: false } }, { archiv: false }]
      });

      res.status(200).send({ success: true, data: students });
    } else if (is_TaiGer_Agent(user)) {
      const permissions = await getPermission(req, user);
      if (permissions && permissions.canAssignAgents) {
        const students = await StudentService.fetchStudents(req, {
          $or: [{ archiv: { $exists: false } }, { archiv: false }]
        });

        res.status(200).send({ success: true, data: students });
      } else {
        const students = await StudentService.fetchStudents(req, {
          agents: user._id,
          $or: [{ archiv: { $exists: false } }, { archiv: false }]
        });
        res.status(200).send({ success: true, data: students });
      }
    } else if (user.role === Role.Editor) {
      const students = await StudentService.fetchStudents(req, {
        editors: user._id,
        $or: [{ archiv: { $exists: false } }, { archiv: false }]
      });
      res.status(200).send({ success: true, data: students });
    }
    // (O): send editor email.
    for (let i = 0; i < student.editors.length; i += 1) {
      informEditorArchivedStudentEmail(
        {
          firstname: student.editors[i].firstname,
          lastname: student.editors[i].lastname,
          address: student.editors[i].email
        },
        {
          std_firstname: student.firstname,
          std_lastname: student.lastname
        }
      );
    }
    if (shouldInform) {
      logger.info(`Inform ${student.firstname} ${student.lastname} to archive`);
      informStudentArchivedStudentEmail(
        {
          firstname: student.firstname,
          lastname: student.lastname,
          address: student.email
        },
        { student }
      );
    }
  } else {
    if (is_TaiGer_Admin(user)) {
      const query = { archiv: true };
      const students = await StudentService.getStudents(req, {
        filter: query,
        options: {}
      });

      res.status(200).send({ success: true, data: students });
    } else if (is_TaiGer_Agent(user)) {
      const query = { agents: user._id, archiv: true };
      const students = await StudentService.getStudents(req, {
        filter: query,
        options: {}
      });

      res.status(200).send({ success: true, data: students });
    } else if (is_TaiGer_Editor(user)) {
      const query = { editors: user._id, archiv: true };
      const students = await StudentService.getStudents(req, {
        filter: query,
        options: {}
      });

      res.status(200).send({ success: true, data: students });
    } else {
      // Guest
      res.status(200).send({ success: true, data: [] });
    }
  }
  next();
});

// (O) email : agent better notification! (only added should be informed.)
// () TODO email : student better notification ()
const assignAgentToStudent = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { studentId },
    body: agentsId // agentsId is json (or agentsId array with boolean)
  } = req;

  try {
    // Data validation
    if (!studentId || !agentsId || typeof agentsId !== 'object') {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid input data.' });
    }

    // Fetch the student
    const student = await StudentService.getStudentById(req, studentId);
    if (!student) {
      return res
        .status(404)
        .json({ success: false, message: 'Student not found.' });
    }

    // Prepare arrays
    const {
      addedUsers: addedAgents,
      removedUsers: removedAgents,
      updatedUsers: updatedAgents,
      toBeInformedUsers: toBeInformedAgents,
      updatedUserIds: updatedAgentIds
    } = await userChangesHelperFunction(req, agentsId, student.agents);

    // Update student's agents
    if (addedAgents.length > 0 || removedAgents.length > 0) {
      // Log the changes here
      logger.info('Agents updated:', {
        added: addedAgents,
        removed: removedAgents
      });
      await StudentService.updateStudentById(req, studentId, {
        'notification.isRead_new_agent_assigned': false,
        agents: updatedAgentIds
      });
    }

    // Populate the updated student data
    const studentUpdated = await StudentService.getStudentById(req, studentId);

    res.status(200).json({ success: true, data: studentUpdated });

    // inform editor-lead
    const Permission = req.db.model('Permission');
    const permissions = await Permission.find({
      canAssignAgents: true
    })
      .populate('user_id', 'firstname lastname email')
      .lean();
    const agentLeads = permissions
      .map((permission) => permission.user_id)
      ?.filter(
        (taigerUser) => taigerUser._id.toString() !== user._id.toString()
      );

    for (const agentLead of agentLeads) {
      if (isNotArchiv(studentUpdated)) {
        if (isNotArchiv(agentLead)) {
          informAgentManagerNewStudentEmail(
            {
              firstname: agentLead.firstname,
              lastname: agentLead.lastname,
              address: agentLead.email
            },
            {
              std_firstname: studentUpdated.firstname,
              std_lastname: studentUpdated.lastname,
              std_id: studentUpdated._id.toString(),
              agents: updatedAgents
            }
          );
        }
      }
    }

    for (let i = 0; i < toBeInformedAgents.length; i += 1) {
      if (isNotArchiv(studentUpdated)) {
        if (isNotArchiv(toBeInformedAgents[i])) {
          informAgentNewStudentEmail(
            {
              firstname: toBeInformedAgents[i].firstname,
              lastname: toBeInformedAgents[i].lastname,
              address: toBeInformedAgents[i].email
            },
            {
              std_firstname: studentUpdated.firstname,
              std_lastname: studentUpdated.lastname,
              std_id: studentUpdated._id.toString()
            }
          );
        }
      }
    }

    if (updatedAgents.length !== 0) {
      if (isNotArchiv(studentUpdated)) {
        informStudentTheirAgentEmail(
          {
            firstname: studentUpdated.firstname,
            lastname: studentUpdated.lastname,
            address: studentUpdated.email
          },
          {
            agents: updatedAgents
          }
        );
      }
    }

    if (addedAgents.length > 0 || removedAgents.length > 0) {
      req.audit = {
        performedBy: user._id,
        targetUserId: studentId, // Change this if you have a different target user ID
        action: 'update', // Action performed
        field: 'agents', // Field that was updated (if applicable)
        changes: {
          before: student.agents, // Before state
          after: {
            added: addedAgents,
            removed: removedAgents
          }
        }
      };
      next();
    }
  } catch (error) {
    logger.error('Error updating agents:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

const assignEditorToStudent = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { studentId },
    body: editorsId
  } = req;
  try {
    // Data validation
    if (!studentId || !editorsId || typeof editorsId !== 'object') {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid input data.' });
    }

    // Fetch the student
    const student = await StudentService.getStudentById(req, studentId);
    if (!student) {
      return res
        .status(404)
        .json({ success: false, message: 'Student not found.' });
    }

    // Prepare arrays
    const {
      addedUsers: addedEditors,
      removedUsers: removedEditors,
      updatedUsers: updatedEditors,
      toBeInformedUsers: toBeInformedEditors,
      updatedUserIds: updatedEditorIds
    } = await userChangesHelperFunction(req, editorsId, student.editors);

    // Update student's editors
    if (addedEditors.length > 0 || removedEditors.length > 0) {
      // Log the changes here
      logger.info('Editors updated:', {
        added: addedEditors,
        removed: removedEditors
      });
      await StudentService.updateStudentById(req, studentId, {
        'notification.isRead_new_agent_assigned': false,
        editors: updatedEditorIds
      });
    }

    // Populate the updated student data
    const studentUpdated = await StudentService.getStudentById(req, studentId);

    res.status(200).json({ success: true, data: studentUpdated });

    // -------------------------------------

    for (let i = 0; i < toBeInformedEditors.length; i += 1) {
      if (isNotArchiv(student)) {
        if (isNotArchiv(toBeInformedEditors[i])) {
          informEditorNewStudentEmail(
            {
              firstname: toBeInformedEditors[i].firstname,
              lastname: toBeInformedEditors[i].lastname,
              address: toBeInformedEditors[i].email
            },
            {
              std_firstname: student.firstname,
              std_lastname: student.lastname,
              std_id: student._id.toString()
            }
          );
        }
      }
    }
    // TODO: inform Agent for assigning editor.
    for (let i = 0; i < studentUpdated.agents.length; i += 1) {
      if (isNotArchiv(student)) {
        if (isNotArchiv(studentUpdated.agents[i])) {
          informAgentStudentAssignedEmail(
            {
              firstname: studentUpdated.agents[i].firstname,
              lastname: studentUpdated.agents[i].lastname,
              address: studentUpdated.agents[i].email
            },
            {
              std_firstname: student.firstname,
              std_lastname: student.lastname,
              std_id: student._id.toString(),
              editors: studentUpdated.editors
            }
          );
        }
      }
    }

    if (updatedEditors.length !== 0) {
      if (isNotArchiv(student)) {
        await informStudentTheirEditorEmail(
          {
            firstname: student.firstname,
            lastname: student.lastname,
            address: student.email
          },
          {
            editors: updatedEditors
          }
        );
      }
    }

    if (addedEditors.length > 0 || removedEditors.length > 0) {
      req.audit = {
        performedBy: user._id,
        targetUserId: studentId, // Change this if you have a different target user ID
        action: 'update', // Action performed
        field: 'editors', // Field that was updated (if applicable)
        changes: {
          before: student.editors, // Before state
          after: {
            added: addedEditors,
            removed: removedEditors
          }
        }
      };
      next();
    }
  } catch (error) {
    logger.error('Error updating editors:', error);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

const assignAttributesToStudent = asyncHandler(async (req, res, next) => {
  const {
    params: { studentId },
    body: attributesId
  } = req;

  await StudentService.updateStudentById(req, studentId, {
    attributes: attributesId
  });

  const student_upated = await StudentService.getStudentById(req, studentId);

  res.status(200).send({ success: true, data: student_upated });
  next();
});

module.exports = {
  getStudentAndDocLinks,
  updateDocumentationHelperLink,
  getActiveStudents,
  getStudentsV3,
  getStudents,
  getStudentsByIds,
  getStudentsAndDocLinks,
  updateStudentsArchivStatus,
  assignAgentToStudent,
  assignEditorToStudent,
  assignAttributesToStudent
};
