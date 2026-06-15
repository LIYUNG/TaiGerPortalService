import {
  Role,
  is_TaiGer_Agent,
  is_TaiGer_Editor,
  is_TaiGer_Student,
  is_TaiGer_Admin
} from '@taiger-common/core';
import mongoose from 'mongoose';

import { asyncHandler } from '../middlewares/error-handler';
import {
  add_portals_registered_status,
  userChangesHelperFunction
} from '../utils/utils_function';
import logger from '../services/logger';
import {
  informEditorArchivedStudentEmail,
  informStudentArchivedStudentEmail,
  informAgentNewStudentEmail,
  informStudentTheirAgentEmail,
  informEditorNewStudentEmail,
  informStudentTheirEditorEmail,
  informAgentStudentAssignedEmail,
  informAgentManagerNewStudentEmail
} from '../services/email';

import { isNotArchiv } from '../constants';
import { getPermission } from '../utils/queryFunctions';
import StudentService from '../services/students';
import UserQueryBuilder from '../builders/UserQueryBuilder';
import ApplicationService from '../services/applications';
import { getAuditLogs } from '../services/audit';
import UserService from '../services/users';
import PermissionService from '../services/permissions';
import BasedocumentationslinkService from '../services/basedocumentationslinks';

const getStudentAndDocLinks = asyncHandler(async (req, res) => {
  const {
    user,
    params: { studentId }
  } = req;
  const applicationsPromise =
    ApplicationService.getApplicationsByStudentId(studentId);

  const studentPromise = StudentService.getStudentByIdWithDocThreads(studentId);

  const base_docs_linkPromise =
    BasedocumentationslinkService.findByCategory('base-documents');
  const survey_linkPromise =
    BasedocumentationslinkService.findByCategory('survey');
  const auditPromise = getAuditLogs(
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

  // Ensure isLocked field exists (default to false if undefined for existing applications)
  // Existing applications should be unlocked to avoid disrupting running workflows
  // Lock mechanism only applies to newly created applications
  const applicationsWithDefaults = applications.map((app) => {
    if (app.isLocked === undefined) {
      app.isLocked = false; // Existing applications default to unlocked
    }
    return app;
  });

  // TODO: remove agent notfication for new documents upload
  student.applications = add_portals_registered_status(
    applicationsWithDefaults
  );

  res.status(200).send({
    success: true,
    data: student,
    base_docs_link,
    survey_link,
    audit
  });
  if (is_TaiGer_Agent(user)) {
    await UserService.updateUser(user._id.toString(), {
      $pull: {
        'agent_notification.isRead_new_base_docs_uploaded': {
          student_id: studentId
        }
      }
    });
  }
});

const updateDocumentationHelperLink = asyncHandler(async (req, res) => {
  const { link, key, category } = req.body;
  // if not in database, then create one
  // otherwise: update the existing one.
  await BasedocumentationslinkService.upsertByCategoryKey(category, key, {
    link,
    updatedAt: new Date()
  });

  const updated_helper_link =
    await BasedocumentationslinkService.findByCategory(category);
  res.status(200).send({ success: true, helper_link: updated_helper_link });
});

const getActiveStudents = asyncHandler(async (req, res) => {
  const { editors, agents, archiv } = req.query;
  const { filter } = new UserQueryBuilder()
    .withEditors(editors ? new mongoose.Types.ObjectId(editors) : null)
    .withAgents(agents ? new mongoose.Types.ObjectId(agents) : null)
    .withArchiv(archiv)
    .build();

  const students = await StudentService.getStudentsWithApplications(filter);
  res.status(200).send({ success: true, data: students });
});

const getStudentsByIds = asyncHandler(async (req, res) => {
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

  const students = await StudentService.getStudentsWithApplications({
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
});

const getStudentsV3 = asyncHandler(async (req, res) => {
  const { editors, agents, archiv } = req.query;
  const { filter } = new UserQueryBuilder()
    .withEditors(editors)
    .withAgents(agents)
    .withArchiv(archiv)
    .build();

  const students = await StudentService.fetchStudents(filter);

  res.status(200).send({ success: true, data: students });
});

const getStudentsV3Paginated = asyncHandler(async (req, res) => {
  const { editors, agents, archiv } = req.query;
  const { filter } = new UserQueryBuilder()
    .withEditors(editors)
    .withAgents(agents)
    .withArchiv(archiv)
    .build();

  const result = await StudentService.getStudentsPaginated({
    filter,
    query: req.query
  });

  res.status(200).send({ success: true, data: result });
});

const getStudent = asyncHandler(async (req, res) => {
  const {
    params: { studentId }
  } = req;

  const student = await StudentService.getStudentById(studentId);

  if (!student) {
    return res
      .status(404)
      .json({ success: false, message: 'Student not found.' });
  }

  res.status(200).send({ success: true, data: student });
});

const getStudentsAndDocLinks = asyncHandler(async (req, res) => {
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
    const students = await StudentService.fetchSimpleStudents(filter);
    res.status(200).send({ success: true, data: students, base_docs_link: {} });
  } else if (is_TaiGer_Student(user)) {
    const obj = user.notification; // create object
    obj['isRead_base_documents_rejected'] = true; // set value
    const student = await StudentService.updateStudentById(
      user._id.toString(),
      {
        notification: obj
      }
    );

    const base_docs_link = await BasedocumentationslinkService.findByCategory(
      'base-documents'
    );
    res.status(200).send({ success: true, data: [student], base_docs_link });
  } else {
    // Guest
    res.status(200).send({ success: true, data: [user] });
  }
});

// () TODO email : agent better notification! (only added or removed should be informed.)
// (O) email : inform student close service
// (O) email : inform editor that student is archived.
const updateStudentsArchivStatus = asyncHandler(async (req, res) => {
  const {
    user,
    params: { studentId },
    body: { isArchived, shouldInform }
  } = req;

  // TODO: data validation for isArchived and studentId
  const student = await StudentService.updateStudentById(studentId, {
    archiv: isArchived
  });

  if (isArchived) {
    // return dashboard students
    if (user.role === Role.Admin) {
      const students = await StudentService.fetchStudents({
        $or: [{ archiv: { $exists: false } }, { archiv: false }]
      });

      res.status(200).send({ success: true, data: students });
    } else if (is_TaiGer_Agent(user)) {
      const permissions = await getPermission(req, user);
      if (permissions && permissions.canAssignAgents) {
        const students = await StudentService.fetchStudents({
          $or: [{ archiv: { $exists: false } }, { archiv: false }]
        });

        res.status(200).send({ success: true, data: students });
      } else {
        const students = await StudentService.fetchStudents({
          agents: user._id,
          $or: [{ archiv: { $exists: false } }, { archiv: false }]
        });
        res.status(200).send({ success: true, data: students });
      }
    } else if (user.role === Role.Editor) {
      const students = await StudentService.fetchStudents({
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
      const students = await StudentService.getStudents({
        filter: query,
        options: {}
      });

      res.status(200).send({ success: true, data: students });
    } else if (is_TaiGer_Agent(user)) {
      const query = { agents: user._id, archiv: true };
      const students = await StudentService.getStudents({
        filter: query,
        options: {}
      });

      res.status(200).send({ success: true, data: students });
    } else if (is_TaiGer_Editor(user)) {
      const query = { editors: user._id, archiv: true };
      const students = await StudentService.getStudents({
        filter: query,
        options: {}
      });

      res.status(200).send({ success: true, data: students });
    } else {
      // Guest
      res.status(200).send({ success: true, data: [] });
    }
  }
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
    const student = await StudentService.getStudentById(studentId);
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
      await StudentService.updateStudentById(studentId, {
        'notification.isRead_new_agent_assigned': false,
        agents: updatedAgentIds
      });
    }

    // Populate the updated student data
    const studentUpdated = await StudentService.getStudentById(studentId);

    res.status(200).json({ success: true, data: studentUpdated });

    // inform editor-lead
    const permissions = await PermissionService.findPermissionsWithUser({
      canAssignAgents: true
    });
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
    const student = await StudentService.getStudentById(studentId);
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
      await StudentService.updateStudentById(studentId, {
        'notification.isRead_new_agent_assigned': false,
        editors: updatedEditorIds
      });
    }

    // Populate the updated student data
    const studentUpdated = await StudentService.getStudentById(studentId);

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

const assignAttributesToStudent = asyncHandler(async (req, res) => {
  const {
    params: { studentId },
    body: attributesId
  } = req;

  await StudentService.updateStudentById(studentId, {
    attributes: attributesId
  });

  const student_upated = await StudentService.getStudentById(studentId);

  res.status(200).send({ success: true, data: student_upated });
});

export = {
  getStudentAndDocLinks,
  updateDocumentationHelperLink,
  getActiveStudents,
  getStudentsV3,
  getStudentsV3Paginated,
  getStudent,
  getStudentsByIds,
  getStudentsAndDocLinks,
  updateStudentsArchivStatus,
  assignAgentToStudent,
  assignEditorToStudent,
  assignAttributesToStudent
};
