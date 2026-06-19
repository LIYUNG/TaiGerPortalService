import { FilterQuery } from 'mongoose';
import { IAudit } from '@taiger-common/model';
import AuditDAO from '../dao/audit.dao';

/**
 * AuditService — business layer for audit logs. Delegates data access to the
 * DAO (controller -> service -> dao).
 */
const AuditService = {
  getAuditLogs(
    filter: FilterQuery<IAudit>,
    options: { limit: number; skip: number; sort: Record<string, 1 | -1> }
  ) {
    return AuditDAO.getAuditLogs(filter, options);
  },

  createAuditLog(auditLog: Partial<IAudit>) {
    return AuditDAO.createAuditLog(auditLog);
  }
};

export = AuditService;
