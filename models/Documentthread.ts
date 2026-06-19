import { documentThreadsSchema } from '@taiger-common/model';
import { model } from 'mongoose';

documentThreadsSchema.index(
  { student_id: 1, application_id: 1, file_type: 1 },
  { unique: true }
);
export const Documentthread = model('Documentthread', documentThreadsSchema);

export { documentThreadsSchema };
