const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('./error-handler');
const DocumentThreadService = require('../services/documentthreads');

const doc_thread_ops_validator = asyncHandler(async (req, res, next) => {
  const {
    params: { messagesThreadId }
  } = req;
  const document_thread = await DocumentThreadService.getThreadByIdLean(
    messagesThreadId
  );
  if (document_thread.isFinalVersion) {
    return next(
      new ErrorResponse(
        423,
        'The finished thread cannot be modified. Please undo finish and do the operation again.'
      )
    );
  }
  next();
});

module.exports = {
  doc_thread_ops_validator
};
