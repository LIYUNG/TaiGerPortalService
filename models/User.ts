import {
  userSchema as UserSchema,
  agentSchema,
  editorSchema,
  studentSchema,
  externalSchema,
  managerSchema
} from '@taiger-common/model';
import { model, Schema } from 'mongoose';
import { Role } from '@taiger-common/core';

import bcrypt from 'bcryptjs';

const options = { discriminatorKey: 'role', timestamps: true };

// CV / profile detail fields consumed by the CV draft generator and reusable by
// other documents (ML/RL/visa). Added here via schema.add() so the shared
// @taiger-common/model package does not need republishing. These are general
// profile metadata that the CV happens to use — not CV-owned data.
UserSchema.add({
  personal_information: {
    nationality: { type: String, default: '' },
    birthplace: { type: String, default: '' },
    address: { type: String, default: '' },
    phone: { type: String, default: '' }
  },
  professional_experience: [
    {
      _id: false,
      period: String,
      job_title: String,
      company: String,
      city: String,
      country: String,
      bullets: [String]
    }
  ],
  awards: [{ _id: false, date: String, title: String, description: String }],
  skills: {
    computer: [{ _id: false, name: String, level: String }],
    other: [String]
  },
  interests: {
    hobbies: { type: String, default: '' },
    social_engagement: { type: String, default: '' },
    competitive_sports: { type: String, default: '' }
  }
});

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

export const User = model('User', UserSchema);

export const Guest = User.discriminator(
  'Guest',
  new Schema({}, options),
  Role.Guest
);

export const Student = User.discriminator(
  'Student',
  studentSchema,
  Role.Student
);

export const External = User.discriminator(
  'External',
  externalSchema,
  Role.External
);

export const Manager = User.discriminator(
  'Manager',
  managerSchema,
  Role.Manager
);

export const Agent = User.discriminator('Agent', agentSchema, Role.Agent);

export const Editor = User.discriminator('Editor', editorSchema, Role.Editor);

export const Admin = User.discriminator(
  'Admin',
  new Schema({}, options),
  Role.Admin
);

export { UserSchema };
