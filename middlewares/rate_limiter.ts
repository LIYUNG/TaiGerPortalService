const rateLimit = require('express-rate-limit');

const DownloadTemplateRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 60 minutes
  max: 20, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const registerRateLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 60 minutes
  max: 20, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per `window` (here, per 15 minutes)
  message: 'Too many login, please try again after an hour',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const activateAccountRateLimiter = rateLimit({
  windowMs: 20 * 60 * 1000, // 20 minutes
  max: 20, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const resendActivationRateLimiter = rateLimit({
  windowMs: 20 * 60 * 1000, // 20 minutes
  max: 20, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const forgotPasswordRateLimiter = rateLimit({
  windowMs: 20 * 60 * 1000, // 20 minutes
  max: 20, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const resetPasswordRateLimiter = rateLimit({
  windowMs: 20 * 60 * 1000, // 20 minutes
  max: 20, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const updateCredentialRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 60 minutes
  max: 20, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const updatePersonalInformationRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 10 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const TranscriptAnalyserRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 60 minutes
  max: 50, // Limit each IP to 50 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const RemoveNotificationRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 60 minutes
  max: 50, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const GeneralGETRequestRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Limit each IP to 200 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const GeneralGETSearchRequestRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Limit each IP to 200 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const GeneralPUTRequestRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const GeneralDELETERequestRateLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const GeneralPOSTRequestRateLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const postMessagesRateLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 50, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const putMessagesRateLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const postMessagesImageRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const getNumberUnreadMessagesRateLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 150, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const getMessagesRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const putThreadInputRateLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const resetThreadInputRateLimiter = rateLimit({
  windowMs: 30 * 60 * 1000, // 30 minutes
  max: 30, // Limit each IP to 30 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const getMessageFileRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 30 minutes
  max: 40, // Limit each IP to 40 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const SetStatusMessagesThreadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 60 minutes
  max: 50, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const GetProgramListRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 * 1 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const GetProgramRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 * 1 minutes
  max: 120, // Limit each IP to 120 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const PostProgramRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 * 1 minutes
  max: 10, // Limit each IP to 10 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const UpdateProgramRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 * 1 minutes
  max: 30, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const DeleteProgramRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 30 * 1 minutes
  max: 20, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const GetTicketListRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 * 1 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const GetTicketRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 * 1 minutes
  max: 120, // Limit each IP to 120 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const PostTicketRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 * 1 minutes
  max: 10, // Limit each IP to 10 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const UpdateTicketRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 * 1 minutes
  max: 30, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const DeleteTicketRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 30 * 1 minutes
  max: 20, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const GetComplaintListRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 * 1 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const GetComplaintRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 * 1 minutes
  max: 120, // Limit each IP to 120 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const PostComplaintRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 * 1 minutes
  max: 10, // Limit each IP to 10 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const UpdateComplaintRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 * 1 minutes
  max: 30, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const DeleteComplaintRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 30 * 1 minutes
  max: 20, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const DocumentationGETRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 * 1 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const InterviewGETRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 * 1 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

const InterviewPUTRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 * 1 minutes
  max: 50, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false // Disable the `X-RateLimit-*` headers
});

module.exports = {
  DownloadTemplateRateLimiter,
  GeneralGETRequestRateLimiter,
  GeneralGETSearchRequestRateLimiter,
  GeneralPUTRequestRateLimiter,
  GeneralPOSTRequestRateLimiter,
  GeneralDELETERequestRateLimiter,
  registerRateLimiter,
  loginRateLimiter,
  activateAccountRateLimiter,
  resendActivationRateLimiter,
  forgotPasswordRateLimiter,
  resetPasswordRateLimiter,
  updatePersonalInformationRateLimiter,
  TranscriptAnalyserRateLimiter,
  RemoveNotificationRateLimiter,
  updateCredentialRateLimiter,
  postMessagesRateLimiter,
  putMessagesRateLimiter,
  postMessagesImageRateLimiter,
  getNumberUnreadMessagesRateLimiter,
  getMessagesRateLimiter,
  putThreadInputRateLimiter,
  resetThreadInputRateLimiter,
  getMessageFileRateLimiter,
  SetStatusMessagesThreadRateLimiter,
  GetProgramListRateLimiter,
  GetProgramRateLimiter,
  PostProgramRateLimiter,
  UpdateProgramRateLimiter,
  DeleteProgramRateLimiter,
  GetTicketListRateLimiter,
  GetTicketRateLimiter,
  PostTicketRateLimiter,
  UpdateTicketRateLimiter,
  DeleteTicketRateLimiter,
  GetComplaintListRateLimiter,
  GetComplaintRateLimiter,
  PostComplaintRateLimiter,
  UpdateComplaintRateLimiter,
  DeleteComplaintRateLimiter,
  DocumentationGETRateLimiter,
  InterviewGETRateLimiter,
  InterviewPUTRateLimiter
};
