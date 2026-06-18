import mongoose from 'mongoose';

// Defined locally (not in @taiger-common/model): a single saved-but-unsent
// message per (user_id, student_id) communication thread. `message` holds the
// EditorJS OutputData as a JSON string, mirroring Communication.message.
const communicationDraftSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    message: { type: String, default: '' }
  },
  { timestamps: true }
);

// One draft per user per student conversation.
communicationDraftSchema.index({ user_id: 1, student_id: 1 }, { unique: true });

export = {
  communicationDraftSchema
};
