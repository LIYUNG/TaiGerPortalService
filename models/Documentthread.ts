import { documentThreadsSchema } from '@taiger-common/model';
import { model, SchemaDefinition } from 'mongoose';

// Thread-scoped free-text context for the CV draft (student + editor editable,
// persisted, but generation stays internal-only). Added via schema.add() to
// avoid republishing @taiger-common/model.
// Cast: documentThreadsSchema is typed to IDocumentthread, which does not yet
// declare this field; schema.add() accepts the extra path at runtime.
documentThreadsSchema.add({
  additional_information: { type: String, default: '' },
  // Persisted AI CV draft (CVDraftResult: draft + validation + meta) so it
  // survives a page refresh until the editor renders/discards it.
  cv_draft: { type: Object }
} as SchemaDefinition);

documentThreadsSchema.index(
  { student_id: 1, application_id: 1, file_type: 1 },
  { unique: true }
);
export const Documentthread = model('Documentthread', documentThreadsSchema);

export { documentThreadsSchema };
