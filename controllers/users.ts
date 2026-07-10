import _ from 'lodash';
import crypto from 'crypto';
import generator from 'generate-password';
import { Role, is_TaiGer_Admin } from '@taiger-common/core';
import mongoose from 'mongoose';
import type {
  GetUsersCountResponse,
  AddUserResponse,
  GetUsersResponse,
  GetUsersPaginatedResponse,
  GetUserResponse,
  UpdateUserResponse,
  UpdateArchivUserResponse,
  DeleteUserResponse,
  GetUsersOverviewResponse
} from '@taiger-common/model';
import { ErrorResponse } from '../common/errors';
import { asyncRoute } from '../middlewares/error-handler';
import {
  updateNotificationEmail,
  sendInvitationEmail
} from '../services/email';
import logger from '../services/logger';
import {
  fieldsValidation,
  checkUserFirstname,
  checkUserLastname,
  checkEmail
} from '../common/validation';
import { AWS_S3_BUCKET_NAME } from '../config';
import { emptyS3Directory } from '../utils/modelHelper/versionControl';
import UserService from '../services/users';
import TokenService from '../services/tokens';
import UserQueryBuilder from '../builders/UserQueryBuilder';
import type { AuthedRequest } from '../types/express';

// `req.audit` is attached at runtime for the downstream `auditLog` middleware
// (routes/users.ts POST /). It is not part of the shared Express.Request
// augmentation, so narrow it locally where this handler writes it.
type RequestWithAudit = AuthedRequest & {
  audit?: {
    performedBy: unknown;
    targetUserId: unknown;
    action: string;
    field: string;
    changes: { before: unknown; after: unknown };
  };
};

const generateRandomToken = () => crypto.randomBytes(32).toString('hex');
const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

// If user deleted, but some files still remain in S3, this function is to address this issue.
// const UserS3GarbageCollector = asyncHandler(async () => {
//   logger.info('Trying to delete redundant file for deleted users.');
//   const listParamsPublic = {
//     Bucket: AWS_S3_BUCKET_NAME,
//     Delimiter: '/',
//     Prefix: ''
//   };
//   const listedObjectsPublic = await s3
//     .listObjectsV2(listParamsPublic)
//     .promise();
//   if (listedObjectsPublic.CommonPrefixes.length > 0) {
//     for (let i = 0; i < listedObjectsPublic.CommonPrefixes.length; i += 1) {
//       const Obj = listedObjectsPublic.CommonPrefixes[i];
//       const student_id = Obj.Prefix.replace('/', '');
//       try {
//         const student = await UserModel('User').findById(student_id);
//         if (!student) {
//           // Obj.Prefix = folder_name/
//           emptyS3Directory(AWS_S3_BUCKET_NAME, `${Obj.Prefix}`);
//         }
//       } catch (err) {
//         logger.error(err);
//       }
//     }
//   }
// });

const getUsersCount = asyncRoute<GetUsersCountResponse>(async (req, res) => {
  const countData = await UserService.getUserRoleCounts();
  res.status(200).send({ success: true, data: countData });
});

const addUser = asyncRoute<AddUserResponse>(async (req, res, next) => {
  await fieldsValidation(
    checkUserFirstname,
    checkUserLastname,
    checkEmail
  )(req);

  const {
    firstname_chinese,
    lastname_chinese,
    firstname,
    lastname,
    email,
    role = 'Student',
    applying_program_count,
    ...args
  } = req.body;
  const { user } = req;
  const existUser = await UserService.getUserByEmail(email);
  if (existUser) {
    logger.error('addUser: An account with this email address already exists');
    throw new ErrorResponse(
      409,
      'An account with this email address already exists'
    );
  }

  if (role === Role.Admin) {
    throw new ErrorResponse(409, 'Admin role is not allowed to be added');
  }
  // TODO: check if email address exists in the world!
  const password = generator.generate({
    length: 10,
    numbers: true
  });

  const newUser = await UserService.createUser(role, {
    firstname_chinese,
    lastname_chinese,
    firstname,
    lastname,
    email,
    role,
    applying_program_count,
    password,
    ...args
  });

  const activationToken = generateRandomToken();
  await TokenService.createToken({
    userId: newUser._id.toString(),
    value: hashToken(activationToken)
  });

  const users = await UserService.getUsers({});
  // TODO: to be improved, only return the new user. Need to check dependency in frontend
  res.status(201).send({
    success: true,
    data: users as unknown as AddUserResponse['data'],
    newUser: newUser._id as unknown as AddUserResponse['newUser']
  });

  await sendInvitationEmail(
    { firstname, lastname, address: email },
    { token: activationToken, password }
  );

  (req as RequestWithAudit).audit = {
    performedBy: user._id,
    targetUserId: newUser._id, // Change this if you have a different target user ID
    action: 'create', // Action performed
    field: 'object', // Field that was updated (if applicable)
    changes: {
      before: null, // Before state
      after: {
        newUser: {
          firstname: newUser.firstname,
          lastname: newUser.lastname,
          firstname_chinese: newUser.firstname_chinese,
          lastname_chinese: newUser.lastname_chinese,
          email: newUser.email
        }
      }
    }
  };

  next();
});

const getUsers = asyncRoute<GetUsersResponse | GetUsersPaginatedResponse>(
  async (req, res) => {
    const {
      agents,
      editors,
      archiv,
      role,
      page,
      limit,
      search,
      sortBy,
      sortOrder
    } = req.query as {
      agents?: string;
      editors?: string;
      archiv?: string;
      role?: string;
      page?: string;
      limit?: string;
      search?: string;
      sortBy?: string;
      sortOrder?: string;
    };

    const builder = new UserQueryBuilder()
      .withEditors(editors ? new mongoose.Types.ObjectId(editors) : null)
      .withAgents(agents ? new mongoose.Types.ObjectId(agents) : null)
      .withArchiv(archiv)
      .withRole(role);

    const { filter } = builder.build();
    const isPaginated = page !== undefined || limit !== undefined;

    if (isPaginated) {
      const paginationQuery = UserService.parseUsersPaginationQuery({
        page,
        limit,
        search,
        sortBy,
        sortOrder
      });

      const {
        users,
        total,
        page: currentPage,
        limit: pageSize
      } = await UserService.getUsersPaginated({
        filter,
        ...paginationQuery
      } as Parameters<typeof UserService.getUsersPaginated>[0]);

      return res.status(200).send({
        success: true,
        data: users as unknown as GetUsersPaginatedResponse['data'],
        total,
        page: currentPage,
        limit: pageSize
      });
    }

    const users = await UserService.getUsers(filter);
    res.status(200).send({
      success: true,
      data: users as unknown as GetUsersResponse['data']
    });
  }
);

const getUser = asyncRoute<GetUserResponse>(async (req, res) => {
  const { user_id } = req.params as { user_id: string };
  const user = await UserService.getUserById(user_id);

  res
    .status(200)
    .send({ success: true, data: user as unknown as GetUserResponse['data'] });
});

// (O) TODO email notify user
const updateUser = asyncRoute<UpdateUserResponse>(async (req, res) => {
  const { user_id } = req.params as { user_id: string };
  const fields = _.pick(req.body, ['email', 'role']);
  // TODO: check if email in use already and if role is valid
  if (is_TaiGer_Admin(fields)) {
    logger.warn(`updateUser: User role is changed to ${fields.role}`);
    throw new ErrorResponse(
      409,
      `Forbidden: User role is changed to ${fields.role}`
    );
  }
  // TODO: if Agent or editor change role, remove their belong students!
  // const students = await StudentModel.updateMany(
  //   {
  //     agents: { $in: user_id }
  //   },
  //   {
  //     $pull: { agents: user_id }
  //   },
  //   { multi: true }
  // );

  const new_user = await UserService.updateUserWithOptions(user_id, fields, {
    runValidators: true,
    overwriteDiscriminatorKey: true,
    // upsert: true,
    new: true
  });
  const updated_user = await UserService.getUserById(user_id);
  res.status(200).send({
    success: true,
    data: new_user as unknown as UpdateUserResponse['data']
  });

  if (!updated_user) {
    return;
  }

  // Email inform user, the updated status
  await updateNotificationEmail(
    {
      firstname: updated_user.firstname,
      lastname: updated_user.lastname,
      address: updated_user.email
    },
    {}
  );
});

const updateUserArchivStatus = asyncRoute<UpdateArchivUserResponse>(
  async (req, res) => {
    const { user_id } = req.params as { user_id: string };
    const { isArchived } = req.body;

    // TODO: data validation for isArchived and user_id
    const _updated_user = await UserService.updateUserArchiv(
      user_id,
      isArchived
    );
    const users = await UserService.getUsers({});
    res.status(200).send({
      success: true,
      data: users as unknown as UpdateArchivUserResponse['data']
    });
  }
);

const deleteUser = asyncRoute<DeleteUserResponse>(async (req, res) => {
  const { user_id } = req.params as { user_id: string };
  const user_deleting = await UserService.getUserById(user_id);

  if (!user_deleting) {
    logger.error('deleteUser: Invalid user id');
    throw new ErrorResponse(404, 'User not found');
  }

  // Delete Admin
  if (
    user_deleting.role === Role.Admin ||
    user_deleting.role === Role.External
  ) {
    await UserService.deleteUserById(user_id);
  }

  // delete from agent/editor
  if (user_deleting.role === Role.Agent || user_deleting.role === Role.Editor) {
    // remove agent / editor from students
    const students = await UserService.pullStaffFromStudents(user_id);
    await UserService.deleteUserById(user_id);
    logger.info(`deleted userid ${user_id}`);
    logger.info(students as unknown as string);
  }

  if (
    user_deleting.role === Role.Student ||
    user_deleting.role === Role.Guest
  ) {
    try {
      // Delete all S3 data of the student
      logger.info('Trying to delete student and their S3 files');
      emptyS3Directory(AWS_S3_BUCKET_NAME, `${user_id}/`);

      // Delete the student and every document they own.
      await UserService.deleteStudentCascade(user_id);
      logger.info('studnet deleted');
    } catch (error) {
      logger.error('Failed to delete user ', error as Record<string, unknown>);
      throw error;
    }
  }
  res.status(200).send({ success: true });
});

/**
 * Get high-level overview and aggregated statistics about Users/Students
 * Provides metrics useful for dashboard and overview pages including:
 * - Total user/student count by role
 * - Distribution by country, target degree, application preferences
 * - Academic background statistics
 * - Language proficiency statistics
 * - Application statistics
 * - Top agents/editors by student count
 * - Recently registered students
 *
 * @route GET /api/users/overview
 * @access Protected - Admin, Manager, Agent, Editor
 * @returns {Object} Overview object with aggregated user/student statistics
 */
const getUsersOverview = asyncRoute<GetUsersOverviewResponse>(
  async (req, res) => {
    // Run multiple aggregations in parallel for better performance
    const {
      byTargetDegree,
      byApplicationSemester,
      byTargetField,
      byProgramLanguage,
      byUniversityProgram
    } = await UserService.getUsersOverview();

    const overview = {
      byTargetDegree: byTargetDegree.filter((item) => item.degree),
      byApplicationSemester: byApplicationSemester.filter(
        (item) => item.semester
      ),
      byTargetField: byTargetField.filter((item) => item.field),
      byProgramLanguage: byProgramLanguage.filter((item) => item.language),
      byUniversity: byUniversityProgram.filter((item) => item.university),
      generatedAt: new Date()
    };

    logger.info('Users overview generated successfully');
    return res.send({
      success: true,
      data: overview as unknown as GetUsersOverviewResponse['data']
    });
  }
);

export = {
  // UserS3GarbageCollector,
  getUsersCount,
  addUser,
  getUsers,
  getUser,
  updateUserArchivStatus,
  updateUser,
  deleteUser,
  getUsersOverview
};
