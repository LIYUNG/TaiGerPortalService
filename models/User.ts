const {
  userSchema: UserSchema,
  agentSchema,
  editorSchema,
  studentSchema,
  externalSchema,
  managerSchema
} = require('@taiger-common/model');
const { model, Schema } = require('mongoose');
const { Role } = require('@taiger-common/core');

const bcrypt = require('bcryptjs');

const options = { discriminatorKey: 'role', timestamps: true };

// eslint-disable-next-line func-names, consistent-return
UserSchema.pre('save', async function (next) {
  const user = this;
  if (!user.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(user.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// eslint-disable-next-line func-names, consistent-return
UserSchema.pre('findOneAndUpdate', async function (next) {
  const update = this.getUpdate();

  // Check if password is being modified
  if (update.password || (update.$set && update.$set.password)) {
    try {
      const newPassword = update.password || update.$set.password;
      const salt = await bcrypt.genSalt(10);
      const hashed = await bcrypt.hash(newPassword, salt);

      if (update.password) {
        update.password = hashed;
      } else {
        update.$set.password = hashed;
      }
    } catch (err) {
      return next(err);
    }
  }

  next();
});

// eslint-disable-next-line func-names
UserSchema.methods.verifyPassword = function (password) {
  const user = this;
  return bcrypt.compare(password, user.password);
};

// eslint-disable-next-line func-names
UserSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.__v;
  delete user.password;
  return user;
};

UserSchema.index({
  firstname: 'text',
  lastname: 'text',
  lastname_chinese: 'text',
  firstname_chinese: 'text',
  email: 'text'
});

const User = model('User', UserSchema);

const Guest = User.discriminator('Guest', new Schema({}, options), Role.Guest);

const Student = User.discriminator('Student', studentSchema, Role.Student);

const External = User.discriminator('External', externalSchema, Role.External);

const Manager = User.discriminator('Manager', managerSchema, Role.Manager);

const Agent = User.discriminator('Agent', agentSchema, Role.Agent);

const Editor = User.discriminator('Editor', editorSchema, Role.Editor);

const Admin = User.discriminator('Admin', new Schema({}, options), Role.Admin);

module.exports = {
  User,
  UserSchema,
  Guest,
  Student,
  Agent,
  External,
  Editor,
  Manager,
  Admin
};
