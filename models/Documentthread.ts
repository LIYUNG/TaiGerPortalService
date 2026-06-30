import { documentThreadsSchema } from '@taiger-common/model';
import { model } from 'mongoose';

// Thread-scoped free-text context for the CV draft (student + editor editable,
// persisted, but generation stays internal-only). Added via schema.add() to
// avoid republishing @taiger-common/model.
// Cast: documentThreadsSchema is typed to IDocumentthread, which does not yet
// declare this field; schema.add() accepts the extra path at runtime.
documentThreadsSchema.add({
  additional_information: { type: String, default: '' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

documentThreadsSchema.index(
  { student_id: 1, application_id: 1, file_type: 1 },
  { unique: true }
);
export const Documentthread = model('Documentthread', documentThreadsSchema);

export { documentThreadsSchema };
