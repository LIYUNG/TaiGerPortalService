import { asyncHandler } from '../middlewares/error-handler';
import UserQueryBuilder from '../builders/UserQueryBuilder';
import AuditService from '../services/audit';

const getAuditLogs = asyncHandler(async (req, res) => {
  const { page, limit, sortBy, sortOrder } = req.query;
  const { filter, options } = new UserQueryBuilder()
    .withPagination(page, limit)
    .withSort(sortBy, sortOrder)
    .build();
  const auditLogs = await AuditService.getAuditLogs(filter, options);
  res.status(200).send({ success: true, data: auditLogs });
});

export = {
  getAuditLogs
};
