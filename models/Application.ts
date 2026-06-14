import { applicationSchema } from '@taiger-common/model';

applicationSchema.index({ studentId: 1 });
module.exports = {
  applicationSchema
};
