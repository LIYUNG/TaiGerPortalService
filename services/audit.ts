import AuditDAO from '../dao/audit.dao';

/**
 * AuditService — business layer for audit logs. Delegates data access to the
 * DAO (controller -> service -> dao).
 */
const AuditService = {
  getAuditLogs(filter, options) {
    return AuditDAO.getAuditLogs(filter, options);
  },

  createAuditLog(auditLog) {
    return AuditDAO.createAuditLog(auditLog);
  }
};

export = AuditService;
