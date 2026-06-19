import { auditSchema } from '@taiger-common/model';

auditSchema.index({ performedBy: 1, targetUserId: 1, targetDocumentId: 1 });
export { auditSchema };
