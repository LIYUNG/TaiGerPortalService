// SurveyInputService methods are thin pass-throughs to SurveyInputDAO. This is
// a UNIT test: the DAO is mocked so no database is touched. Each test asserts
// the right DAO method is called once with the exact args and that the service
// returns the DAO's result unchanged.
jest.mock('../../dao/surveyInput.dao');

import SurveyInputDAO from '../../dao/surveyInput.dao';
import SurveyInputService from '../../services/surveyInputs';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SurveyInputService (mocked DAO)', () => {
  it('findSurveyInputs delegates to DAO.findSurveyInputs', () => {
    const filter = { student_id: 's1' };
    const daoResult = [{ _id: 'si1' }];
    SurveyInputDAO.findSurveyInputs.mockReturnValue(daoResult);

    const result = SurveyInputService.findSurveyInputs(filter);

    expect(SurveyInputDAO.findSurveyInputs).toHaveBeenCalledTimes(1);
    expect(SurveyInputDAO.findSurveyInputs).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });

  it('getSurveyInputById delegates to DAO.getSurveyInputById', () => {
    const id = 'si1';
    const daoResult = { _id: 'si1' };
    SurveyInputDAO.getSurveyInputById.mockReturnValue(daoResult);

    const result = SurveyInputService.getSurveyInputById(id);

    expect(SurveyInputDAO.getSurveyInputById).toHaveBeenCalledTimes(1);
    expect(SurveyInputDAO.getSurveyInputById).toHaveBeenCalledWith(id);
    expect(result).toBe(daoResult);
  });

  it('createSurveyInput delegates to DAO.createSurveyInput', () => {
    const payload = { student_id: 's1', answers: {} };
    const daoResult = { _id: 'si1', ...payload };
    SurveyInputDAO.createSurveyInput.mockReturnValue(daoResult);

    const result = SurveyInputService.createSurveyInput(payload);

    expect(SurveyInputDAO.createSurveyInput).toHaveBeenCalledTimes(1);
    expect(SurveyInputDAO.createSurveyInput).toHaveBeenCalledWith(payload);
    expect(result).toBe(daoResult);
  });

  it('updateSurveyInputById delegates to DAO.updateSurveyInputById', () => {
    const id = 'si1';
    const payload = { answers: { q1: 'a' } };
    const daoResult = { _id: 'si1', ...payload };
    SurveyInputDAO.updateSurveyInputById.mockReturnValue(daoResult);

    const result = SurveyInputService.updateSurveyInputById(id, payload);

    expect(SurveyInputDAO.updateSurveyInputById).toHaveBeenCalledTimes(1);
    expect(SurveyInputDAO.updateSurveyInputById).toHaveBeenCalledWith(
      id,
      payload
    );
    expect(result).toBe(daoResult);
  });

  it('deleteSurveyInput delegates to DAO.deleteSurveyInput', () => {
    const filter = { student_id: 's1' };
    const daoResult = { deletedCount: 1 };
    SurveyInputDAO.deleteSurveyInput.mockReturnValue(daoResult);

    const result = SurveyInputService.deleteSurveyInput(filter);

    expect(SurveyInputDAO.deleteSurveyInput).toHaveBeenCalledTimes(1);
    expect(SurveyInputDAO.deleteSurveyInput).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });
});
