const { asyncHandler } = require('../middlewares/error-handler');
const UserQueryBuilder = require('../builders/UserQueryBuilder');
const AuditService = require('../services/audit');

const getAuditLogs = asyncHandler(async (req, res) => {
  const { page, limit, sortBy, sortOrder } = req.query;
  const { filter, options } = new UserQueryBuilder()
    .withPagination(page, limit)
    .withSort(sortBy, sortOrder)
    .build();
  const auditLogs = await AuditService.getAuditLogs(req, filter, options);
  res.status(200).send({ success: true, data: auditLogs });
});

module.exports = {
  getAuditLogs
};
