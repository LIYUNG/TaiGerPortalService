import {
  Role,
  is_TaiGer_Agent,
  is_TaiGer_Editor,
  is_TaiGer_Student,
  is_TaiGer_Admin
} from '@taiger-common/core';
import mongoose from 'mongoose';
import { Request } from 'express';

import { asyncRoute } from '../middlewares/error-handler';
import {
  add_portals_registered_status,
  userChangesHelperFunction
} from '../utils/utils_function';
import logger from '../services/logger';
import {
  informEditorArchivedStudentEmail as informEditorArchivedStudentEmailRaw,
  informStudentArchivedStudentEmail as informStudentArchivedStudentEmailRaw,
  informAgentNewStudentEmail as informAgentNewStudentEmailRaw,
  informStudentTheirAgentEmail as informStudentTheirAgentEmailRaw,
  informEditorNewStudentEmail as informEditorNewStudentEmailRaw,
  informStudentTheirEditorEmail as informStudentTheirEditorEmailRaw,
  informAgentStudentAssignedEmail as informAgentStudentAssignedEmailRaw,
  informAgentManagerNewStudentEmail as informAgentManagerNewStudentEmailRaw
} from '../services/email';

import { isNotArchiv } from '../constants';
import { getPermission as getPermissionRaw } from '../utils/queryFunctions';
import StudentService from '../services/students';
import UserQueryBuilder from '../builders/UserQueryBuilder';
import ApplicationService from '../services/applications';
import { getAuditLogs } from '../services/audit';
import UserService from '../services/users';
import PermissionService from '../services/permissions';
import BasedocumentationslinkService from '../services/basedocumentationslinks';
import type {
  IAgent,
  IApplication,
  IEditor,
  IProgram,
  IStudent,
  IUser,
  GetStudentsResponse,
  GetActiveStudentsResponse,
  GetStudentResponse,
  UpdateStudentAgentsResponse,
  UpdateStudentEditorsResponse,
  UpdateStudentAttributesResponse
} from '@taiger-common/model';

// Several handlers attach the student's applications onto the (lean) student doc
// before responding; mirror that shape for typed reads/writes.
type StudentWithApplications = IStudent & {
  applications?: ApplicationWithProgram[];
};

// ApplicationService.getApplicationsByStudentId lean-populates `programId` to a
// full IProgram (see dao/application.dao.ts's `.populate('programId', ...)`).
// utils/utils_function.ts's add_portals_registered_status assumes exactly this
// shape via its own (unexported) local alias — mirror it structurally here.
type ApplicationWithProgram = Omit<IApplication, 'programId'> & {
  programId: IProgram;
};

// `req.user` is populated by the `protect` auth middleware — routes/students.ts
// mounts `router.use(protect)` ahead of every handler below, so `req.user` is
// always a real authenticated user document by the time these handlers run.
// The shared Express.Request augmentation (types/express.d.ts) types it as
// `any`, but it also merges with @types/passport's `Express.User` (an empty
// interface) which is what `req.user` actually resolves to at the call sites
// below. Re-assert the concrete runtime shape locally instead of threading
// `any`/`{}` through this file.
type AuthUser = IUser & { _id: mongoose.Types.ObjectId };

// `req.requestId` / `req.audit` are attached at runtime by other middleware
// (middlewares/requestContext.ts, and an audit-logging middleware downstream
// of the `next()` calls below) but are not part of the shared Express.Request
// augmentation. Narrow locally wherever this file reads/writes them.
type RequestWithContext = Request & {
  requestId?: string;
  audit?: {
    performedBy: unknown;
    targetUserId: string;
    action: string;
    field: string;
    changes: { before: unknown; after: unknown };
  };
};

// The inform*Email helpers are asyncHandler-wrapped (typed as 3-arg Express
// handlers) but invoked here as 2-arg (recipient, msg) notifiers. These aliases
// restore their real call shape — TS-only, no runtime change. See FLAGS re:
// asyncHandler misuse in services/email.
type EmailRecipient = {
  firstname?: string | null;
  lastname?: string | null;
  address?: string | null;
};
type InformEmail = (
  recipient: EmailRecipient,
  msg: Record<string, unknown>
) => Promise<unknown>;
const informEditorArchivedStudentEmail =
  informEditorArchivedStudentEmailRaw as unknown as InformEmail;
const informStudentArchivedStudentEmail =
  informStudentArchivedStudentEmailRaw as unknown as InformEmail;
const informAgentNewStudentEmail =
  informAgentNewStudentEmailRaw as unknown as InformEmail;
const informStudentTheirAgentEmail =
  informStudentTheirAgentEmailRaw as unknown as InformEmail;
const informEditorNewStudentEmail =
  informEditorNewStudentEmailRaw as unknown as InformEmail;
const informStudentTheirEditorEmail =
  informStudentTheirEditorEmailRaw as unknown as InformEmail;
const informAgentStudentAssignedEmail =
  informAgentStudentAssignedEmailRaw as unknown as InformEmail;
const informAgentManagerNewStudentEmail =
  informAgentManagerNewStudentEmailRaw as unknown as InformEmail;

// getPermission is likewise an asyncHandler-wrapped helper (typed 3-arg) called
// here as a 2-arg (req, user) lookup. TS-only cast, no runtime change. See FLAGS.
const getPermission = getPermissionRaw as unknown as (
  req: unknown,
  user: AuthUser
) => Promise<{ canAssignAgents?: boolean; canAssignEditors?: boolean } | null>;

// NOTE: left untyped — the runtime payload carries `base_docs_link`,
// `survey_link` and `audit` fields that the api response type
// `GetStudentDocLinksResponse` does not declare.
const getStudentAndDocLinks = asyncRoute(async (req, res) => {
  const user = req.user as AuthUser;
  const studentId = String(req.params.studentId);
  // Must be the *WithCredentials* variant: portal_credentials.account/password
  // are `select: false`, so the plain query leaves them undefined and
  // add_portals_registered_status below then marks every portal-bearing
  // program as unregistered. The helper deletes the raw credentials again
  // before the payload is sent.
  const applicationsPromise =
    ApplicationService.getApplicationsWithCredentialsByStudentId(studentId);

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
      // skip: 0 is behaviour-identical to the previous (undefined -> no skip).
      skip: 0,
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
  }) as unknown as ApplicationWithProgram[];

  // TODO: remove agent notfication for new documents upload
  (student as unknown as StudentWithApplications).applications =
    add_portals_registered_status(applicationsWithDefaults);

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

// NOTE: left untyped — the runtime payload returns a `helper_link` field that
// the api response type `UpdateDocumentationHelperLinkResponse` (success/message
// only) does not declare.
const updateDocumentationHelperLink = asyncRoute(async (req, res) => {
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

const getActiveStudents = asyncRoute<GetActiveStudentsResponse>(
  async (req, res) => {
    const { editors, agents, archiv } = req.query;
    const { filter } = new UserQueryBuilder()
      .withEditors(
        typeof editors === 'string'
          ? new mongoose.Types.ObjectId(editors)
          : null
      )
      .withAgents(
        typeof agents === 'string' ? new mongoose.Types.ObjectId(agents) : null
      )
      .withArchiv(archiv)
      .build();

    const students = await StudentService.getStudentsWithApplications(filter);
    res.status(200).send({
      success: true,
      data: students as unknown as GetActiveStudentsResponse['data']
    });
  }
);

// NOTE: left untyped — the runtime payload carries an `invalidIds` field (and a
// non-data `message`) that no `@taiger-common/model` students response declares.
const getStudentsByIds = asyncRoute(async (req, res) => {
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
    {
      validObjectIds: [] as mongoose.Types.ObjectId[],
      invalidIds: [] as string[]
    }
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
      requestId: (req as RequestWithContext).requestId
    });
  }

  const students = await StudentService.getStudentsWithApplications({
    _id: { $in: validObjectIds }
  });

  const responsePayload: {
    success: boolean;
    data: typeof students;
    message?: string;
    invalidIds?: string[];
  } = {
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

const getStudentsV3 = asyncRoute<GetStudentsResponse>(async (req, res) => {
  const { editors, agents, archiv } = req.query;
  const { filter } = new UserQueryBuilder()
    .withEditors(editors)
    .withAgents(agents)
    .withArchiv(archiv)
    .build();

  const students = await StudentService.fetchStudents(filter);

  res.status(200).send({
    success: true,
    data: students as unknown as GetStudentsResponse['data']
  });
});

// NOTE: left untyped — returns a paginated envelope (`data` is a page object,
// not the `IStudentResponseDef[]` the students response types declare).
const getStudentsV3Paginated = asyncRoute(async (req, res) => {
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

const getStudent = asyncRoute<GetStudentResponse>(async (req, res) => {
  const studentId = String(req.params.studentId);

  const student = await StudentService.getStudentById(studentId);

  if (!student) {
    return res
      .status(404)
      .json({ success: false, message: 'Student not found.' });
  }

  res.status(200).send({
    success: true,
    data: student as unknown as GetStudentResponse['data']
  });
});

// NOTE: left untyped — the runtime payload carries a `base_docs_link` field the
// api response type `GetStudentsAndDocLinksResponse` does not declare.
const getStudentsAndDocLinks = asyncRoute(async (req, res) => {
  const user = req.user as AuthUser;
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
    const obj = user.notification!; // create object (always set for a real user doc)
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
// NOTE: left untyped — most branches respond with `data` as a student ARRAY,
// but the api response type `UpdateArchivStudentsResponse` declares `data` as a
// single `IStudentResponseDef`. Runtime shape preserved as-is.
const updateStudentsArchivStatus = asyncRoute(async (req, res) => {
  const user = req.user as AuthUser;
  const {
    body: { isArchived, shouldInform }
  } = req;
  const studentId = String(req.params.studentId);

  // TODO: data validation for isArchived and studentId
  const student = (await StudentService.updateStudentById(studentId, {
    archiv: isArchived
  })) as unknown as IStudent | null;

  if (!student) {
    logger.error('updateStudentsArchivStatus: Invalid student id');
    return res
      .status(404)
      .send({ success: false, message: 'Invalid student id' });
  }

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
    const editors = (student.editors ?? []) as IEditor[];
    for (let i = 0; i < editors.length; i += 1) {
      informEditorArchivedStudentEmail(
        {
          firstname: editors[i].firstname,
          lastname: editors[i].lastname,
          address: editors[i].email
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
const assignAgentToStudent = asyncRoute<UpdateStudentAgentsResponse>(
  async (req, res, next) => {
    const user = req.user as AuthUser;
    const { body: agentsId } = req; // agentsId is json (or agentsId array with boolean)
    const studentId = String(req.params.studentId);

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
      } = await userChangesHelperFunction(agentsId, student.agents);

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
      const studentUpdated = (await StudentService.getStudentById(
        studentId
      )) as unknown as (IStudent & { _id: { toString(): string } }) | null;

      res.status(200).json({
        success: true,
        data: studentUpdated as unknown as UpdateStudentAgentsResponse['data']
      });

      // Response already sent; skip the email side-effects if the student vanished.
      if (!studentUpdated) {
        return;
      }

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
          if (isNotArchiv(toBeInformedAgents[i] as unknown as IUser)) {
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
        (req as RequestWithContext).audit = {
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
      logger.error('Error updating agents:', error as Record<string, unknown>);
      res
        .status(500)
        .json({ success: false, message: 'Internal server error.' });
    }
  }
);

const assignEditorToStudent = asyncRoute<UpdateStudentEditorsResponse>(
  async (req, res, next) => {
    const user = req.user as AuthUser;
    const { body: editorsId } = req;
    const studentId = String(req.params.studentId);
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
      } = await userChangesHelperFunction(editorsId, student.editors);

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
      const studentUpdated = (await StudentService.getStudentById(
        studentId
      )) as unknown as
        | (IStudent & { _id: { toString(): string }; agents?: IAgent[] })
        | null;

      res.status(200).json({
        success: true,
        data: studentUpdated as unknown as UpdateStudentEditorsResponse['data']
      });

      // Response already sent; skip the email side-effects if the student vanished.
      if (!studentUpdated) {
        return;
      }

      // -------------------------------------

      for (let i = 0; i < toBeInformedEditors.length; i += 1) {
        if (isNotArchiv(student as unknown as IUser)) {
          if (isNotArchiv(toBeInformedEditors[i] as unknown as IUser)) {
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
      const updatedAgentsList = (studentUpdated.agents ?? []) as IAgent[];
      for (let i = 0; i < updatedAgentsList.length; i += 1) {
        if (isNotArchiv(student as unknown as IUser)) {
          if (isNotArchiv(updatedAgentsList[i])) {
            informAgentStudentAssignedEmail(
              {
                firstname: updatedAgentsList[i].firstname,
                lastname: updatedAgentsList[i].lastname,
                address: updatedAgentsList[i].email
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
        if (isNotArchiv(student as unknown as IUser)) {
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
        (req as RequestWithContext).audit = {
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
      logger.error('Error updating editors:', error as Record<string, unknown>);
      res
        .status(500)
        .json({ success: false, message: 'Internal server error.' });
    }
  }
);

const assignAttributesToStudent = asyncRoute<UpdateStudentAttributesResponse>(
  async (req, res) => {
    const { body: attributesId } = req;
    const studentId = String(req.params.studentId);

    await StudentService.updateStudentById(studentId, {
      attributes: attributesId
    });

    const student_upated = await StudentService.getStudentById(studentId);

    res.status(200).send({
      success: true,
      data: student_upated as unknown as UpdateStudentAttributesResponse['data']
    });
  }
);

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
