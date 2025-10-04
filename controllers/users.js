const _ = require('lodash');
const crypto = require('crypto');
const generator = require('generate-password');
const { Role } = require('@taiger-common/core');
const mongoose = require('mongoose');
const { is_TaiGer_Admin } = require('@taiger-common/core');
const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const {
  updateNotificationEmail,
  sendInvitationEmail
} = require('../services/email');
const logger = require('../services/logger');
const {
  fieldsValidation,
  checkUserFirstname,
  checkUserLastname,
  checkEmail
} = require('../common/validation');
const { AWS_S3_BUCKET_NAME } = require('../config');
const { emptyS3Directory } = require('../utils/modelHelper/versionControl');
const UserService = require('../services/users');
const UserQueryBuilder = require('../builders/UserQueryBuilder');

const generateRandomToken = () => crypto.randomBytes(32).toString('hex');
const hashToken = (token) =>
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
//         const student = await req.db.model('User').findById(student_id);
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

const getUsersCount = asyncHandler(async (req, res) => {
  const result = await req.db.model('User').aggregate([
    // Group all users together and count by role
    {
      $group: {
        _id: null,
        totalUsers: { $sum: 1 },
        adminCount: {
          $sum: {
            $cond: [{ $eq: ['$role', 'Admin'] }, 1, 0]
          }
        },
        agentCount: {
          $sum: {
            $cond: [{ $eq: ['$role', 'Agent'] }, 1, 0]
          }
        },
        editorCount: {
          $sum: {
            $cond: [{ $eq: ['$role', 'Editor'] }, 1, 0]
          }
        },
        studentCount: {
          $sum: {
            $cond: [{ $eq: ['$role', 'Student'] }, 1, 0]
          }
        },
        guestCount: {
          $sum: {
            $cond: [{ $eq: ['$role', 'Guest'] }, 1, 0]
          }
        },
        externalCount: {
          $sum: {
            $cond: [{ $eq: ['$role', 'External'] }, 1, 0]
          }
        }
      }
    },

    // Project the counts as a single object
    {
      $project: {
        _id: 0,
        totalUsers: 1,
        adminCount: 1,
        agentCount: 1,
        editorCount: 1,
        studentCount: 1,
        guestCount: 1,
        externalCount: 1
      }
    }
  ]);

  // Extract the first (and only) result object
  const countData =
    result.length > 0
      ? result[0]
      : {
          totalUsers: 0,
          adminCount: 0,
          agentCount: 0,
          editorCount: 0,
          studentCount: 0,
          guestCount: 0,
          externalCount: 0
        };

  res.status(200).send({ success: true, data: countData });
});

const addUser = asyncHandler(async (req, res, next) => {
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
    applying_program_count
  } = req.body;
  const { user } = req;
  const existUser = await req.db.model('User').findOne({ email });
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

  const collectionName = role === Role.Student ? 'Student' : 'User';
  const newUser = await req.db.model(collectionName).create({
    firstname_chinese,
    lastname_chinese,
    firstname,
    lastname,
    email,
    role,
    applying_program_count,
    password
  });

  const activationToken = generateRandomToken();
  await req.db
    .model('Token')
    .create({ userId: newUser._id, value: hashToken(activationToken) });

  const users = await req.db.model('User').find({}).lean();
  // TODO: to be improved, only return the new user. Need to check dependency in frontend
  res.status(201).send({ success: true, data: users, newUser: newUser._id });

  await sendInvitationEmail(
    { firstname, lastname, address: email },
    { token: activationToken, password }
  );

  req.audit = {
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

const getUsers = asyncHandler(async (req, res) => {
  const { agents, editors, archiv, role } = req.query;
  const { filter } = new UserQueryBuilder()
    .withEditors(editors ? new mongoose.Types.ObjectId(editors) : null)
    .withAgents(agents ? new mongoose.Types.ObjectId(agents) : null)
    .withArchiv(archiv)
    .withRole(role)
    .build();

  const users = await UserService.getUsers(req, filter);
  res.status(200).send({ success: true, data: users });
});

const getUser = asyncHandler(async (req, res) => {
  const { user_id } = req.params;
  const user = await UserService.getUserById(req, user_id);

  res.status(200).send({ success: true, data: user });
});

// (O) TODO email notify user
const updateUser = asyncHandler(async (req, res) => {
  const {
    params: { user_id }
  } = req;
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
  // const students = await req.db.model('Student').updateMany(
  //   {
  //     agents: { $in: user_id }
  //   },
  //   {
  //     $pull: { agents: user_id }
  //   },
  //   { multi: true }
  // );

  const new_user = await req.db
    .model('User')
    .findByIdAndUpdate(user_id, fields, {
      runValidators: true,
      overwriteDiscriminatorKey: true,
      // upsert: true,
      new: true
    })
    .lean();
  const updated_user = await req.db.model('User').findById(user_id);
  res.status(200).send({ success: true, data: new_user });

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

const updateUserArchivStatus = asyncHandler(async (req, res) => {
  const {
    params: { user_id },
    body: { isArchived }
  } = req;

  // TODO: data validation for isArchived and user_id
  let updated_user = await req.db
    .model('User')
    .findByIdAndUpdate(
      user_id,
      {
        archiv: isArchived
      },
      { new: true, strict: false }
    )
    .populate('editors')
    .lean();
  const users = await req.db.model('User').find({}).lean();
  res.status(200).send({ success: true, data: users });
});

const deleteUser = asyncHandler(async (req, res) => {
  const {
    params: { user_id }
  } = req;
  const user_deleting = await req.db.model('User').findById(user_id);

  // Delete Admin
  if (
    user_deleting.role === Role.Admin ||
    user_deleting.role === Role.External
  ) {
    await req.db.model('User').findByIdAndDelete(user_id);
  }

  // delete from agent/editor
  if (user_deleting.role === Role.Agent || user_deleting.role === Role.Editor) {
    // remove agent / editor from students
    const students = await req.db.model('Student').updateMany(
      {
        $or: [{ agents: user_id }, { editors: user_id }]
      },
      {
        $pull: {
          agents: user_id,
          editors: user_id
        }
      },
      { multi: true }
    );
    await req.db.model('User').findByIdAndDelete(user_id);
    logger.info(`deleted userid ${user_id}`);
    logger.info(students);
  }

  if (
    user_deleting.role === Role.Student ||
    user_deleting.role === Role.Guest
  ) {
    const session = await req.db.startSession();
    session.startTransaction();
    try {
      // Delete all S3 data of the student
      logger.info('Trying to delete student and their S3 files');
      emptyS3Directory(AWS_S3_BUCKET_NAME, `${user_id}/`);

      // Delete thread that user has
      await req.db.model('Documentthread').deleteMany({ student_id: user_id });
      logger.info('Threads deleted');

      // delete user applications
      await req.db.model('Application').deleteMany({ studentId: user_id });
      logger.info('Applications deleted');

      // Delete course that user has
      await req.db.model('Course').deleteMany({ student_id: user_id });
      logger.info('Courses deleted');

      // delete user chat
      await req.db.model('Communication').deleteMany({ student_id: user_id });
      logger.info('Chat deleted');

      // delete user complaints
      await req.db.model('Complaint').deleteMany({ requester_id: user_id });
      logger.info('Complaints deleted');

      // delete user events
      await req.db.model('Event').deleteMany({ requester_id: user_id });
      logger.info('Events deleted');

      // delete user interviews
      await req.db.model('Interview').deleteMany({ student_id: user_id });
      logger.info('Interviews deleted');

      // delete user survey inputs
      await req.db.model('surveyInput').deleteMany({ studentId: user_id });
      logger.info('SurveyInputs deleted');

      // delete user tickets
      await req.db.model('Ticket').deleteMany({ requester_id: user_id });
      logger.info('Tickets deleted');

      // delete user in database
      await req.db.model('User').findByIdAndDelete(user_id);
      logger.info('studnet deleted');

      await session.commitTransaction();
      await session.endSession();
    } catch (error) {
      // If any operation fails, abort the transaction
      await session.abortTransaction();
      await session.endSession();
      logger.error('Failed to delete user ', error);
      throw error;
    }
  }
  res.status(200).send({ success: true });
});

module.exports = {
  // UserS3GarbageCollector,
  getUsersCount,
  addUser,
  getUsers,
  getUser,
  updateUserArchivStatus,
  updateUser,
  deleteUser
};
