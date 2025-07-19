const { is_TaiGer_Student } = require('@taiger-common/core');
const { ErrorResponse } = require('../common/errors');
const logger = require('../services/logger');
const ApplicationService = require('../services/applications');

const getProgramFilter = async (req, res, next) => {
  const { user } = req;
  const { programId } = req.params;
  if (is_TaiGer_Student(user)) {
    const myApplications = await ApplicationService.getApplications(req, {
      programId,
      studentId: user._id
    });
    if (
      myApplications.findIndex(
        (app) => app.programId._id.toString() === programId
      ) === -1
    ) {
      logger.error('getProgram: Invalid program id in your applications');
      return res
        .status(403)
        .json(
          new ErrorResponse(403, 'Invalid program id in your applications')
        );
    }
  }
  next();
};

module.exports = getProgramFilter;
