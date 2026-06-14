import { Audit } from '../models';

/**
 * AuditDAO — data access for the Audit model (default-connection model from
 * models/index.js). Plain params, no req.
 */
const AuditDAO = {
  async getAuditLogs(filter, options) {
    return Audit.find(filter)
      .populate(
        'performedBy targetUserId',
        'firstname lastname role pictureUrl'
      )
      .populate({
        path: 'targetDocumentThreadId interviewThreadId',
        select: 'program_id file_type',
        populate: {
          path: 'program_id',
          select: 'school program_name degree semester'
        }
      })
      .limit(options.limit)
      .skip(options.skip)
      .sort(options.sort);
  },

  async createAuditLog(auditLog) {
    return Audit.create(auditLog);
  }
};

export = AuditDAO;
