import mongoose from 'mongoose';

// Defined locally (not in @taiger-common/model): a single saved-but-unsent
// message per (user_id, student_id) communication thread. `message` holds the
// EditorJS OutputData as a JSON string, mirroring Communication.message.
export const communicationDraftSchema = new mongoose.Schema(
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
    message: { type: String, default: '' },
    // Provenance: 'human' for a normal hand-typed draft, 'ai' once an AI-
    // generated reply has been inserted (it may then be edited — it stays 'ai'
    // so we can audit AI-assisted sends). aiOriginalMessage keeps the untouched
    // AI text so the send-time audit can tell "sent as-is" from "edited".
    source: { type: String, enum: ['human', 'ai'], default: 'human' },
    aiModel: { type: String, default: '' },
    aiGeneratedAt: { type: Date },
    aiOriginalMessage: { type: String, default: '' },
    // A generated-but-not-yet-approved AI reply (raw markdown). Persisted so the
    // suggestion survives a reload and the agent can still approve/dismiss it.
    // Kept separate from `message` so it never clobbers text the agent is
    // already typing; cleared on approve (moves into `message`) or dismiss.
    aiPendingSuggestion: { type: String, default: '' },
    aiPendingModel: { type: String, default: '' },
    // Attachments uploaded while drafting (upload-on-attach). `path` is the S3
    // key, `name` the friendly display/download name — same shape as a
    // Communication message file. On send these move onto the message; on
    // unattach / discard / sweep the S3 objects are deleted.
    files: [
      {
        name: { type: String, required: true },
        path: { type: String, required: true }
      }
    ]
  },
  { timestamps: true }
);

// One draft per user per student conversation.
communicationDraftSchema.index({ user_id: 1, student_id: 1 }, { unique: true });
