const {
  is_TaiGer_Editor,
  is_TaiGer_Agent,
  is_TaiGer_Student,
  is_TaiGer_Guest
} = require('@taiger-common/core');

const { ErrorResponse } = require('../common/errors');
const { getPermission } = require('../utils/queryFunctions');
const { asyncHandler } = require('./error-handler');
const InterviewService = require('../services/interviews');

const interviewMultitenantFilter = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { interview_id }
  } = req;
  if (is_TaiGer_Editor(user) || is_TaiGer_Agent(user)) {
    const permissions = await getPermission(req, user);

    const interview = await InterviewService.findInterviewByIdPopulated(
      interview_id,
      [['student_id']]
    );
    if (!interview) {
      next(new ErrorResponse(404, 'Interview not found'));
    }
    if (
      ![
        ...interview.student_id.agents,
        ...interview.student_id.editors,
        ...interview.trainer_id
      ].some((taiger_user) => taiger_user.toString() === user._id.toString()) &&
      !permissions?.canAssignEditors &&
      !permissions?.canAssignAgents
    ) {
      next(
        new ErrorResponse(
          403,
          'Permission denied: Not allowed to access other interview. Please contact administrator.'
        )
      );
    }
  }
  if (is_TaiGer_Student(user) || is_TaiGer_Guest(user)) {
    const interview = await InterviewService.findInterviewByIdPopulated(
      interview_id,
      []
    );
    if (
      interview.student_id?.toString() &&
      user._id.toString() !== interview.student_id?.toString()
    ) {
      return next(
        new ErrorResponse(403, 'Not allowed to access other resource.')
      );
    }
  }
  next();
});

const interviewMultitenantReadOnlyFilter = asyncHandler(
  async (req, res, next) => {
    const {
      user,
      params: { interview_id }
    } = req;

    if (is_TaiGer_Student(user) || is_TaiGer_Guest(user)) {
      const interview = await InterviewService.findByIdRaw(interview_id);
      if (
        interview?.student_id?.toString() &&
        user._id.toString() !== interview?.student_id?.toString()
      ) {
        return next(
          new ErrorResponse(403, 'Not allowed to access other resource.')
        );
      }
    }
    next();
  }
);

module.exports = {
  interviewMultitenantFilter,
  interviewMultitenantReadOnlyFilter
};
