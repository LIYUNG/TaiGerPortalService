import { allCourseSchema } from '@taiger-common/model';

allCourseSchema.index({ updatedBy: 1 });
module.exports = {
  allCourseSchema
};
