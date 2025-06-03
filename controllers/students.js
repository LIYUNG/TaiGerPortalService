const {
  Role,
  is_TaiGer_Agent,
  is_TaiGer_Editor,
  is_TaiGer_External,
  is_TaiGer_Student
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
  createApplicationToStudentEmail,
  informAgentStudentAssignedEmail,
  informAgentManagerNewStudentEmail
} = require('../services/email');

const {
  GENERAL_RLs_CONSTANT,
  RLs_CONSTANT,
  isNotArchiv,
  ManagerType,
  PROGRAM_SPECIFIC_FILETYPE
} = require('../constants');
const { getPermission } = require('../utils/queryFunctions');
const StudentService = require('../services/students');
const UserQueryBuilder = require('../builders/UserQueryBuilder');
const ApplicationService = require('../services/applications');

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
    .populate('agents editors', 'firstname lastname email')
    .populate({
      path: 'generaldocs_threads.doc_thread_id',
      select: 'file_type isFinalVersion updatedAt messages.file',
      populate: {
        path: 'messages.user_id',
        select: 'firstname lastname'
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
  const auditPromise = req.db
    .model('Audit')
    .find({
      targetUserId: studentId
    })
    .populate('performedBy targetUserId', 'firstname lastname role')
    .populate({
      path: 'targetDocumentThreadId interviewThreadId',
      select: 'program_id file_type',
      populate: {
        path: 'program_id',
        select: 'school program_name degree semester'
      }
    })
    .sort({ createdAt: -1 });
  const [student, applications, base_docs_link, survey_link, audit] =
    await Promise.all([
      studentPromise,
      applicationsPromise,
      base_docs_linkPromise,
      survey_linkPromise,
      auditPromise
    ]);
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
  let helper_link = await req.db
    .model('Basedocumentationslink')
    .findOneAndUpdate(
      { category, key },
      {
        $set: {
          link,
          updatedAt: new Date()
        }
      },
      { upsert: true, new: true }
    );

  const updated_helper_link = await req.db
    .model('Basedocumentationslink')
    .find({
      category
    });
  res.status(200).send({ success: true, helper_link: updated_helper_link });
  next();
});

const getAllActiveStudents = asyncHandler(async (req, res, next) => {
  const studentsPromise = StudentService.fetchStudents(req, {
    $or: [{ archiv: { $exists: false } }, { archiv: false }]
  });

  const coursesPromise = req.db
    .model('Course')
    .find()
    .select('-table_data_string')
    .lean();

  // Perform the join
  const [students, courses] = await Promise.all([
    studentsPromise,
    coursesPromise
  ]);

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
  res.status(200).send({ success: true, data: students_new });
  next();
});

const getAllStudents = asyncHandler(async (req, res, next) => {
  const { page, limit, sortBy, sortOrder } = req.query;
  const { filter, options } = new UserQueryBuilder()
    .withRole(Role.Student)
    .withPagination(page, limit)
    .withSort(sortBy, sortOrder)
    .build();
  const students = await StudentService.fetchStudents(req, filter);

  res.status(200).send({ success: true, data: students });
  next();
});
const getStudentsV3 = asyncHandler(async (req, res, next) => {
  const { user } = req;

  if (user.role === Role.Admin) {
    const students = await StudentService.fetchStudents(req, {
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });

    res.status(200).send({ success: true, data: students });
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
    const students = await StudentService.fetchStudents(req, {
      agents: user._id,
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });

    res.status(200).send({
      success: true,
      data: students
    });
  } else if (is_TaiGer_Editor(user)) {
    const permissions = await getPermission(req, user);
    if (permissions && permissions.canAssignEditors) {
      const students = await StudentService.fetchSimpleStudents(req, {
        $or: [{ archiv: { $exists: false } }, { archiv: false }]
      });

      res.status(200).send({ success: true, data: students });
    } else {
      const students = await StudentService.fetchSimpleStudents(req, {
        editors: user._id,
        $or: [{ archiv: { $exists: false } }, { archiv: false }]
      });

      res.status(200).send({ success: true, data: students });
    }
  } else {
    // Guest
    res.status(200).send({ success: true, data: [user] });
  }
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
      .populate('performedBy targetUserId', 'firstname lastname role')
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
      const students = await req.db
        .model('Student')
        .find({
          $or: [{ archiv: { $exists: false } }, { archiv: false }]
        })
        .populate('agents editors', 'firstname lastname email')
        .populate('applications.programId')
        .populate(
          'generaldocs_threads.doc_thread_id applications.doc_modification_thread.doc_thread_id',
          '-messages'
        )
        .select('-notification');

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
    const studentPromise = req.db
      .model('Student')
      .findById(user._id.toString())
      .populate('applications.programId')
      .populate('agents editors', '-students')
      .populate(
        'generaldocs_threads.doc_thread_id applications.doc_modification_thread.doc_thread_id',
        '-messages'
      )
      .select(
        '-attributes +applications.portal_credentials.application_portal_a.account +applications.portal_credentials.application_portal_a.password +applications.portal_credentials.application_portal_b.account +applications.portal_credentials.application_portal_b.password'
      )
      .lean();

    const interviewsPromise = req.db
      .model('Interview')
      .find({
        student_id: user._id.toString()
      })
      .populate('trainer_id', 'firstname lastname email')
      .populate('event_id')
      .lean();

    const [student, interviews] = await Promise.all([
      studentPromise,
      interviewsPromise
    ]);

    if (interviews) {
      for (let i = 0; i < student.applications?.length; i += 1) {
        if (
          interviews.some(
            (interview) =>
              interview.program_id.toString() ===
              student.applications[i].programId._id.toString()
          )
        ) {
          const interview_temp = interviews.find(
            (interview) =>
              interview.program_id.toString() ===
              student.applications[i].programId._id.toString()
          );
          student.applications[i].interview_status = interview_temp.status;
          student.applications[i].interview_trainer_id =
            interview_temp.trainer_id;
          student.applications[i].interview_training_event =
            interview_temp.event_id;
          student.applications[i].interview_id = interview_temp._id.toString();
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
  if (user.role === Role.Admin) {
    const students = await req.db
      .model('Student')
      .find({
        $or: [{ archiv: { $exists: false } }, { archiv: false }]
      })
      .populate('agents', 'firstname lastname email')
      .select('firstname firstname_chinese lastname lastname_chinese profile')
      .lean();
    res.status(200).send({ success: true, data: students, base_docs_link: {} });
  } else if (is_TaiGer_Agent(user)) {
    const students = await req.db
      .model('Student')
      .find({
        agents: user._id,
        $or: [{ archiv: { $exists: false } }, { archiv: false }]
      })
      .populate('agents', 'firstname lastname email')
      .select('firstname firstname_chinese lastname lastname_chinese profile')
      .lean();

    // res.status(200).send({ success: true, data: students, base_docs_link });
    res.status(200).send({ success: true, data: students, base_docs_link: {} });
  } else if (user.role === Role.Editor) {
    const students = await req.db
      .model('Student')
      .find({
        editors: user._id,
        $or: [{ archiv: { $exists: false } }, { archiv: false }]
      })
      .populate('agents', 'firstname lastname email')
      .select('firstname firstname_chinese lastname lastname_chinese profile')
      .select('-notification');
    const base_docs_link = await req.db.model('Basedocumentationslink').find({
      category: 'base-documents'
    });

    res.status(200).send({ success: true, data: students, base_docs_link });
  } else if (is_TaiGer_Student(user)) {
    const obj = user.notification; // create object
    obj['isRead_base_documents_rejected'] = true; // set value
    await req.db
      .model('Student')
      .findByIdAndUpdate(user._id.toString(), { notification: obj }, {});
    const student = await req.db
      .model('Student')
      .findById(user._id.toString())
      .select('firstname firstname_chinese lastname lastname_chinese profile')
      .lean();

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
  const student = await req.db
    .model('Student')
    .findByIdAndUpdate(
      studentId,
      {
        archiv: isArchived
      },
      { new: true, strict: false }
    )
    .populate('agents editors', 'firstname lastname email')
    .lean();

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
        const students = await req.db
          .model('Student')
          .find({
            $or: [{ archiv: { $exists: false } }, { archiv: false }]
          })
          .populate('agents editors', 'firstname lastname email')
          .populate('applications.programId')
          .populate(
            'generaldocs_threads.doc_thread_id applications.doc_modification_thread.doc_thread_id',
            '-messages'
          )
          .select('-notification');

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
    if (user.role === Role.Admin) {
      const students = await req.db
        .model('Student')
        .find({ archiv: true })
        .populate('applications.programId agents editors')
        .lean();
      res.status(200).send({ success: true, data: students });
    } else if (is_TaiGer_Agent(user)) {
      const students = await req.db
        .model('Student')
        .find({
          agents: user._id,
          archiv: true
        })
        .populate('applications.programId agents editors')
        .lean();

      res.status(200).send({ success: true, data: students });
    } else if (user.role === Role.Editor) {
      const students = await req.db
        .model('Student')
        .find({
          editors: user._id,
          archiv: true
        })
        .populate('applications.programId');
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
    const student = await req.db
      .model('Student')
      .findById(studentId)
      .populate('agents', 'firstname lastname email archiv role')
      .lean();
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
      await req.db.model('Student').findByIdAndUpdate(
        studentId,
        {
          'notification.isRead_new_agent_assigned': false,
          agents: updatedAgentIds
        },
        {}
      );
    }

    // Populate the updated student data
    const studentUpdated = await req.db
      .model('Student')
      .findById(studentId)
      .populate('applications.programId agents editors')
      .populate(
        'generaldocs_threads.doc_thread_id applications.doc_modification_thread.doc_thread_id',
        '-messages'
      )
      .lean(); // Optional: Use lean for better performance

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
    const student = await req.db
      .model('Student')
      .findById(studentId)
      .populate('editors', 'firstname lastname email')
      .lean();
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
      await req.db.model('Student').findByIdAndUpdate(
        studentId,
        {
          'notification.isRead_new_agent_assigned': false,
          editors: updatedEditorIds
        },
        {}
      );
    }

    // Populate the updated student data
    const studentUpdated = await req.db
      .model('Student')
      .findById(studentId)
      .populate('applications.programId agents editors')
      .populate(
        'generaldocs_threads.doc_thread_id applications.doc_modification_thread.doc_thread_id',
        '-messages'
      )
      .lean(); // Optional: Use lean for better performance

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

  await req.db
    .model('Student')
    .findByIdAndUpdate(studentId, { attributes: attributesId }, {});

  const student_upated = await req.db
    .model('Student')
    .findById(studentId)
    .populate('applications.programId agents editors')
    .populate(
      'generaldocs_threads.doc_thread_id applications.doc_modification_thread.doc_thread_id',
      '-messages'
    )
    .lean();

  res.status(200).send({ success: true, data: student_upated });
  next();
});

const ToggleProgramStatus = asyncHandler(async (req, res, next) => {
  const {
    params: { studentId, program_id }
  } = req;

  const student = await req.db
    .model('Student')
    .findById(studentId)
    .populate('applications.programId agents editors')
    .populate(
      'generaldocs_threads.doc_thread_id applications.doc_modification_thread.doc_thread_id',
      '-messages'
    );
  if (!student) {
    logger.error('ToggleProgramStatus: Invalid student id');
    throw new ErrorResponse(404, 'Student not found');
  }

  const application = student.applications.find(
    ({ programId }) => programId._id.toString() === program_id
  );
  if (!application) {
    logger.error('ToggleProgramStatus: Invalid application id');
    throw new ErrorResponse(404, 'Application not found');
  }
  application.closed = application.closed === 'O' ? '-' : 'O';
  await student.save();

  res.status(201).send({ success: true, data: student });
  next();
});

// (O) email : student notification
// (O) auto-create document thread for student: ML,RL,Essay
// (if applicable, depending on program list)
// TODO: race condition risk (when send 2 api call concurrently)
const createApplication = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { studentId },
    body: { program_id_set }
  } = req;
  // Limit the number of assigning programs
  const max_application = 20;
  if (program_id_set.length > max_application) {
    logger.error(
      'createApplication: too much program assigned: ',
      program_id_set.length
    );
    throw new ErrorResponse(
      400,
      `You assign too many programs to student. Please select max. ${max_application} programs.`
    );
  }
  const student = await req.db.model('Student').findById(studentId);
  const programObjectIds = program_id_set.map(
    (id) => new mongoose.Types.ObjectId(id)
  );
  const program_ids = await req.db
    .model('Program')
    .find({
      _id: { $in: programObjectIds },
      $or: [{ isArchiv: { $exists: false } }, { isArchiv: false }]
    })
    .lean();
  if (program_ids.length !== programObjectIds.length) {
    logger.error('createApplication: some program_ids invalid');
    throw new ErrorResponse(
      400,
      'Some Programs are out-of-date. Please refresh the page.'
    );
  }
  // limit the number in students application.
  if (student.applications.length + programObjectIds.length > max_application) {
    logger.error(
      `${student.firstname} ${student.lastname} has more than ${max_application} programs!`
    );
    throw new ErrorResponse(
      400,
      `${student.firstname} ${student.lastname} has more than ${max_application} programs!`
    );
  }

  const studentApplications = student.applications.map(
    ({ programId, application_year }) => ({
      programId: programId.toString(),
      application_year
    })
  );

  // () TODO: check if the same university accept more than 1 application (different programs)
  // () TODO: differentiate the case of different year / semester?
  // () TODO: or only show warning?

  // Create programId array only new for student.
  const application_year =
    student.application_preference?.expected_application_date || '<TBD>';
  const new_programIds = program_id_set.filter(
    (id) =>
      !studentApplications.some(
        (app) =>
          app.programId === id && app.application_year === application_year
      )
  );

  // Insert only new programIds for student.
  for (let i = 0; i < new_programIds.length; i += 1) {
    const application = student.applications.create({
      programId: new mongoose.Types.ObjectId(new_programIds[i])
    });
    application.application_year = application_year;
    let program = program_ids.find(
      ({ _id }) => _id.toString() === new_programIds[i]
    );

    // check if RL required, if yes, create new thread
    if (
      program.rl_required !== undefined &&
      Number.isInteger(parseInt(program.rl_required)) >= 0
    ) {
      // TODO: if no specific requirement,
      const nrRLrequired = parseInt(program.rl_required);
      if (isNaN(nrRLrequired)) {
        logger.error(
          `createApplication ${new_programIds[i]}: RL required is not a number`
        );
      }
      const Documentthread = req.db.model('Documentthread');
      const isRLSpecific = program.is_rl_specific;
      const NoRLSpecificFlag =
        isRLSpecific === undefined || isRLSpecific === null;
      // create specific RL tag if flag is false, or no flag and no requirement
      if (
        isRLSpecific === false ||
        (NoRLSpecificFlag && !program.rl_requirements)
      ) {
        // check if general RL is created, if not, create ones!
        const genThreadIds = student.generaldocs_threads.map(
          (thread) => thread.doc_thread_id
        );
        const generalRLcount = await req.db
          .model('Documentthread')
          .find({
            _id: { $in: genThreadIds },
            file_type: { $regex: /Recommendation_Letter_/ }
          })
          .countDocuments();

        if (generalRLcount < nrRLrequired) {
          // create general RL tasks
          logger.info('Create general RL tasks!');
          for (let j = generalRLcount; j < nrRLrequired; j += 1) {
            const newThread = new Documentthread({
              student_id: new mongoose.Types.ObjectId(studentId),
              file_type: GENERAL_RLs_CONSTANT[j],
              updatedAt: new Date()
            });
            const threadEntry = application.doc_modification_thread.create({
              doc_thread_id: new mongoose.Types.ObjectId(newThread._id),
              updatedAt: new Date(),
              createdAt: new Date()
            });

            student.generaldocs_threads.push(threadEntry);
            await newThread.save();
          }
        }
      } else {
        logger.info('Create specific RL tasks!');
        for (let j = 0; j < nrRLrequired; j += 1) {
          const newThread = new Documentthread({
            student_id: new mongoose.Types.ObjectId(studentId),
            file_type: RLs_CONSTANT[j],
            program_id: new mongoose.Types.ObjectId(new_programIds[i]),
            updatedAt: new Date()
          });
          const threadEntry = application.doc_modification_thread.create({
            doc_thread_id: newThread._id,
            updatedAt: new Date(),
            createdAt: new Date()
          });

          application.doc_modification_thread.push(threadEntry);
          await newThread.save();
        }
      }
    }

    // Create supplementary form task
    const Documentthread = req.db.model('Documentthread');

    for (const doc of PROGRAM_SPECIFIC_FILETYPE) {
      if (program[doc.required] === 'yes') {
        const new_doc_thread = new Documentthread({
          student_id: new mongoose.Types.ObjectId(studentId),
          file_type: doc.fileType,
          program_id: new mongoose.Types.ObjectId(new_programIds[i]),
          updatedAt: new Date()
        });
        const temp = application.doc_modification_thread.create({
          doc_thread_id: new_doc_thread._id,
          updatedAt: new Date(),
          createdAt: new Date()
        });

        application.doc_modification_thread.push(temp);
        await new_doc_thread.save();
      }
    }

    student.notification.isRead_new_programs_assigned = false;
    student.applications.push(application);
  }
  await student.save();

  res.status(201).send({ success: true, data: student.applications });

  if (isNotArchiv(student)) {
    await createApplicationToStudentEmail(
      {
        firstname: student.firstname,
        lastname: student.lastname,
        address: student.email
      },
      {
        agent_firstname: user.firstname,
        agent_lastname: user.lastname,
        programs: program_ids
      }
    );
  }
  next();
});

module.exports = {
  getStudentAndDocLinks,
  updateDocumentationHelperLink,
  getAllActiveStudents,
  getAllStudents,
  getStudentsV3,
  getStudents,
  getStudentsAndDocLinks,
  updateStudentsArchivStatus,
  assignAgentToStudent,
  assignEditorToStudent,
  assignAttributesToStudent,
  ToggleProgramStatus,
  createApplication
};
