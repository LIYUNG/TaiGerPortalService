const AuditService = {
  async getAuditLogs(req, filter, options) {
    const auditLogs = await req.db
      .model('Audit')
      .find(filter)
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
    return auditLogs;
  },
  async createAuditLog(req, auditLog) {
    const newAuditLog = await req.db.model('Audit').create(auditLog);
    return newAuditLog;
  }
};

module.exports = AuditService;
