import { ErrorResponse } from '../common/errors';
import { asyncHandler } from '../middlewares/error-handler';
import logger from '../services/logger';
import ProgramChangeRequestService from '../services/programChangeRequests';
import ProgramService from '../services/programs';

const getProgramChangeRequests = asyncHandler(async (req, res) => {
  const { programId } = req.params;
  const changeRequests =
    await ProgramChangeRequestService.getOpenChangeRequestsByProgramId(
      programId
    );
  if (!changeRequests) {
    logger.error('getProgramChangeRequests: Invalid program id');
    throw new ErrorResponse(404, 'ChangeRequests not found');
  }
  res.send({ success: true, data: changeRequests });
});

const submitProgramChangeRequests = asyncHandler(async (req, res) => {
  const { programId } = req.params;
  const changes = req.body;
  const { user } = req;
  const program = await ProgramService.getProgramByIdLean(programId);

  if (!program) {
    logger.error('postProgramChangeRequests: Invalid program id');
    throw new ErrorResponse(404, 'Program not found');
  }

  await ProgramChangeRequestService.upsertChangeRequest(
    programId,
    user._id,
    changes
  );
  res.send({ success: true });
});

const reviewProgramChangeRequest = asyncHandler(async (req, res) => {
  const { requestId } = req.params;
  const { user } = req;
  const changeRequest = await ProgramChangeRequestService.getChangeRequestById(
    requestId
  );
  if (!changeRequest) {
    logger.error('updateProgramChangeRequest: Invalid request id');
    throw new ErrorResponse(404, 'ChangeRequest not found');
  }
  if (changeRequest.reviewedBy) {
    logger.error('updateProgramChangeRequest: Request already reviewed');
    throw new ErrorResponse(400, 'Request already reviewed');
  }
  const updatedChangeRequest =
    await ProgramChangeRequestService.updateChangeRequestById(requestId, {
      reviewedBy: user._id,
      reviewedAt: new Date()
    });
  res.send({ success: true, data: updatedChangeRequest });
});

module.exports = {
  getProgramChangeRequests,
  submitProgramChangeRequests,
  reviewProgramChangeRequest
};
