// InterviewService methods are thin pass-throughs to InterviewDAO and
// InterviewSurveyResponseDAO. This is a UNIT test: both DAOs are mocked so no
// database is touched. Each method is asserted to delegate to the matching DAO
// method with the exact args and to return the DAO's result unchanged.
jest.mock('../../dao/interview.dao');
jest.mock('../../dao/interviewSurveyResponse.dao');

const InterviewDAO = require('../../dao/interview.dao');
const InterviewSurveyResponseDAO = require('../../dao/interviewSurveyResponse.dao');
const InterviewService = require('../../services/interviews');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('InterviewService — InterviewDAO delegators (mocked DAO)', () => {
  it('getInterviews delegates to DAO.getInterviews with filter', async () => {
    const filter = { trainer_id: 't1' };
    const daoResult = [{ _id: 'iv1' }];
    InterviewDAO.getInterviews.mockResolvedValue(daoResult);

    const result = await InterviewService.getInterviews(filter);

    expect(InterviewDAO.getInterviews).toHaveBeenCalledTimes(1);
    expect(InterviewDAO.getInterviews).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });

  it('getInterviewById delegates to DAO.getInterviewById with id', async () => {
    const daoResult = { _id: 'iv1' };
    InterviewDAO.getInterviewById.mockResolvedValue(daoResult);

    const result = await InterviewService.getInterviewById('iv1');

    expect(InterviewDAO.getInterviewById).toHaveBeenCalledTimes(1);
    expect(InterviewDAO.getInterviewById).toHaveBeenCalledWith('iv1');
    expect(result).toBe(daoResult);
  });

  it('getInterviewsByStudentId delegates to DAO.getInterviewsByStudentId', async () => {
    const daoResult = [{ _id: 'iv1' }];
    InterviewDAO.getInterviewsByStudentId.mockResolvedValue(daoResult);

    const result = await InterviewService.getInterviewsByStudentId('s1');

    expect(InterviewDAO.getInterviewsByStudentId).toHaveBeenCalledTimes(1);
    expect(InterviewDAO.getInterviewsByStudentId).toHaveBeenCalledWith('s1');
    expect(result).toBe(daoResult);
  });

  it('findByIdRaw delegates to DAO.findByIdRaw with id', async () => {
    const daoResult = { _id: 'iv1' };
    InterviewDAO.findByIdRaw.mockResolvedValue(daoResult);

    const result = await InterviewService.findByIdRaw('iv1');

    expect(InterviewDAO.findByIdRaw).toHaveBeenCalledTimes(1);
    expect(InterviewDAO.findByIdRaw).toHaveBeenCalledWith('iv1');
    expect(result).toBe(daoResult);
  });

  it('findInterviews delegates to DAO.findInterviews with filter+populates', async () => {
    const filter = { student_id: 's1' };
    const populates = ['student_id'];
    const daoResult = [{ _id: 'iv1' }];
    InterviewDAO.findInterviews.mockResolvedValue(daoResult);

    const result = await InterviewService.findInterviews(filter, populates);

    expect(InterviewDAO.findInterviews).toHaveBeenCalledTimes(1);
    expect(InterviewDAO.findInterviews).toHaveBeenCalledWith(filter, populates);
    expect(result).toBe(daoResult);
  });

  it('findInterviewByIdPopulated delegates to DAO.findInterviewByIdPopulated', async () => {
    const populates = ['student_id'];
    const daoResult = { _id: 'iv1' };
    InterviewDAO.findInterviewByIdPopulated.mockResolvedValue(daoResult);

    const result = await InterviewService.findInterviewByIdPopulated(
      'iv1',
      populates
    );

    expect(InterviewDAO.findInterviewByIdPopulated).toHaveBeenCalledTimes(1);
    expect(InterviewDAO.findInterviewByIdPopulated).toHaveBeenCalledWith(
      'iv1',
      populates
    );
    expect(result).toBe(daoResult);
  });

  it('findOneInterview delegates to DAO.findOneInterview with filter+populates', async () => {
    const filter = { thread_id: 'th1' };
    const populates = ['student_id'];
    const daoResult = { _id: 'iv1' };
    InterviewDAO.findOneInterview.mockResolvedValue(daoResult);

    const result = await InterviewService.findOneInterview(filter, populates);

    expect(InterviewDAO.findOneInterview).toHaveBeenCalledTimes(1);
    expect(InterviewDAO.findOneInterview).toHaveBeenCalledWith(
      filter,
      populates
    );
    expect(result).toBe(daoResult);
  });

  it('distinctTrainedStudentIds delegates to DAO.distinctTrainedStudentIds', async () => {
    const studentIds = ['s1', 's2'];
    const daoResult = ['s1'];
    InterviewDAO.distinctTrainedStudentIds.mockResolvedValue(daoResult);

    const result = await InterviewService.distinctTrainedStudentIds(studentIds);

    expect(InterviewDAO.distinctTrainedStudentIds).toHaveBeenCalledTimes(1);
    expect(InterviewDAO.distinctTrainedStudentIds).toHaveBeenCalledWith(
      studentIds
    );
    expect(result).toBe(daoResult);
  });

  it('updateInterviewByIdRaw delegates to DAO.updateInterviewByIdRaw', async () => {
    const payload = { status: 'done' };
    const daoResult = { _id: 'iv1', status: 'done' };
    InterviewDAO.updateInterviewByIdRaw.mockResolvedValue(daoResult);

    const result = await InterviewService.updateInterviewByIdRaw(
      'iv1',
      payload
    );

    expect(InterviewDAO.updateInterviewByIdRaw).toHaveBeenCalledTimes(1);
    expect(InterviewDAO.updateInterviewByIdRaw).toHaveBeenCalledWith(
      'iv1',
      payload
    );
    expect(result).toBe(daoResult);
  });

  it('updateInterviewByIdPopulated delegates to DAO.updateInterviewByIdPopulated', async () => {
    const payload = { status: 'done' };
    const populates = ['student_id'];
    const daoResult = { _id: 'iv1' };
    InterviewDAO.updateInterviewByIdPopulated.mockResolvedValue(daoResult);

    const result = await InterviewService.updateInterviewByIdPopulated(
      'iv1',
      payload,
      populates
    );

    expect(InterviewDAO.updateInterviewByIdPopulated).toHaveBeenCalledTimes(1);
    expect(InterviewDAO.updateInterviewByIdPopulated).toHaveBeenCalledWith(
      'iv1',
      payload,
      populates
    );
    expect(result).toBe(daoResult);
  });

  it('upsertInterviewPopulated delegates to DAO.upsertInterviewPopulated', async () => {
    const filter = { thread_id: 'th1' };
    const payload = { status: 'open' };
    const populates = ['student_id'];
    const daoResult = { _id: 'iv1' };
    InterviewDAO.upsertInterviewPopulated.mockResolvedValue(daoResult);

    const result = await InterviewService.upsertInterviewPopulated(
      filter,
      payload,
      populates
    );

    expect(InterviewDAO.upsertInterviewPopulated).toHaveBeenCalledTimes(1);
    expect(InterviewDAO.upsertInterviewPopulated).toHaveBeenCalledWith(
      filter,
      payload,
      populates
    );
    expect(result).toBe(daoResult);
  });

  it('deleteInterviewById delegates to DAO.deleteInterviewById with id', async () => {
    const daoResult = { deletedCount: 1 };
    InterviewDAO.deleteInterviewById.mockResolvedValue(daoResult);

    const result = await InterviewService.deleteInterviewById('iv1');

    expect(InterviewDAO.deleteInterviewById).toHaveBeenCalledTimes(1);
    expect(InterviewDAO.deleteInterviewById).toHaveBeenCalledWith('iv1');
    expect(result).toBe(daoResult);
  });

  it('aggregateInterviews delegates to DAO.aggregateInterviews with pipeline', async () => {
    const pipeline = [{ $match: { trainer_id: 't1' } }];
    const daoResult = [{ _id: 'iv1' }];
    InterviewDAO.aggregateInterviews.mockResolvedValue(daoResult);

    const result = await InterviewService.aggregateInterviews(pipeline);

    expect(InterviewDAO.aggregateInterviews).toHaveBeenCalledTimes(1);
    expect(InterviewDAO.aggregateInterviews).toHaveBeenCalledWith(pipeline);
    expect(result).toBe(daoResult);
  });
});

describe('InterviewService — InterviewSurveyResponseDAO delegators (mocked DAO)', () => {
  it('findSurveys delegates to surveyDAO.findSurveys with filter+populates', async () => {
    const filter = { interview_id: 'iv1' };
    const populates = ['student_id'];
    const daoResult = [{ _id: 'sr1' }];
    InterviewSurveyResponseDAO.findSurveys.mockResolvedValue(daoResult);

    const result = await InterviewService.findSurveys(filter, populates);

    expect(InterviewSurveyResponseDAO.findSurveys).toHaveBeenCalledTimes(1);
    expect(InterviewSurveyResponseDAO.findSurveys).toHaveBeenCalledWith(
      filter,
      populates
    );
    expect(result).toBe(daoResult);
  });

  it('findOneSurvey delegates to surveyDAO.findOneSurvey with filter+populates', async () => {
    const filter = { interview_id: 'iv1' };
    const populates = ['student_id'];
    const daoResult = { _id: 'sr1' };
    InterviewSurveyResponseDAO.findOneSurvey.mockResolvedValue(daoResult);

    const result = await InterviewService.findOneSurvey(filter, populates);

    expect(InterviewSurveyResponseDAO.findOneSurvey).toHaveBeenCalledTimes(1);
    expect(InterviewSurveyResponseDAO.findOneSurvey).toHaveBeenCalledWith(
      filter,
      populates
    );
    expect(result).toBe(daoResult);
  });

  it('upsertSurvey delegates to surveyDAO.upsertSurvey with filter+payload+populates', async () => {
    const filter = { interview_id: 'iv1' };
    const payload = { score: 5 };
    const populates = ['student_id'];
    const daoResult = { _id: 'sr1' };
    InterviewSurveyResponseDAO.upsertSurvey.mockResolvedValue(daoResult);

    const result = await InterviewService.upsertSurvey(
      filter,
      payload,
      populates
    );

    expect(InterviewSurveyResponseDAO.upsertSurvey).toHaveBeenCalledTimes(1);
    expect(InterviewSurveyResponseDAO.upsertSurvey).toHaveBeenCalledWith(
      filter,
      payload,
      populates
    );
    expect(result).toBe(daoResult);
  });

  it('deleteOneSurvey delegates to surveyDAO.deleteOneSurvey with filter', async () => {
    const filter = { interview_id: 'iv1' };
    const daoResult = { deletedCount: 1 };
    InterviewSurveyResponseDAO.deleteOneSurvey.mockResolvedValue(daoResult);

    const result = await InterviewService.deleteOneSurvey(filter);

    expect(InterviewSurveyResponseDAO.deleteOneSurvey).toHaveBeenCalledTimes(1);
    expect(InterviewSurveyResponseDAO.deleteOneSurvey).toHaveBeenCalledWith(
      filter
    );
    expect(result).toBe(daoResult);
  });
});
