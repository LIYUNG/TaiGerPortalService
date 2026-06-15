import { asyncHandler } from '../../middlewares/error-handler';
import logger from '../../services/logger';
import AuditService from '../../services/audit';

const auditLog = asyncHandler(async (req) => {
  try {
    const { user, audit } = req;

    if (!audit) return;

    const newAuditLog = {
      performedBy: user._id,
      targetUserId: audit.targetUserId, // Change this if you have a different target user ID
      targetDocumentThreadId: audit.targetDocumentThreadId, // Change this if relevant
      interviewThreadId: audit.interviewThreadId, // Change this if relevant
      action: audit.action, // Action performed
      field: audit.field, // Field that was updated (if applicable)
      changes: {
        before: audit.changes.before, // Before state
        after: audit.changes.after // After state
      }
    };

    await AuditService.createAuditLog(newAuditLog);
  } catch (e) {
    logger.error(e);
  }
});

export = {
  auditLog
};
