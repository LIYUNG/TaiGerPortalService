import { is_TaiGer_Student } from '@taiger-common/core';
import { ErrorResponse } from '../common/errors';
import logger from '../services/logger';
import ApplicationService from '../services/applications';

const getProgramFilter = async (req, res, next) => {
  const { user } = req;
  const { programId } = req.params;
  if (is_TaiGer_Student(user)) {
    const myApplications = await ApplicationService.getApplications({
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

export = getProgramFilter;
