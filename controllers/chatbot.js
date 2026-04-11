const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const { runChatbot } = require('../services/chatbot');

const chatbotMessage = asyncHandler(async (req, res) => {
  const { message, studentId, maxMessagePages } = req.body;

  if (!message || typeof message !== 'string') {
    throw new ErrorResponse(400, 'message is required');
  }

  if (!studentId || typeof studentId !== 'string') {
    throw new ErrorResponse(400, 'studentId is required');
  }

  const result = await runChatbot(req, {
    message,
    studentId,
    maxMessagePages
  });

  res.status(200).send({
    success: true,
    data: result
  });
});

module.exports = {
  chatbotMessage
};
