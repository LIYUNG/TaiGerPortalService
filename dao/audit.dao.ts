import { FilterQuery } from 'mongoose';
import { IAudit } from '@taiger-common/model';
import { Audit } from '../models';

/**
 * AuditDAO — data access for the Audit model (default-connection model from
 * models/index.js). Plain params, no req.
 */
const AuditDAO = {
  async getAuditLogs(
    filter: FilterQuery<IAudit>,
    options: { limit: number; skip: number; sort: Record<string, 1 | -1> }
  ) {
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

  async createAuditLog(auditLog: Partial<IAudit>) {
    return Audit.create(auditLog);
  }
};

export = AuditDAO;
