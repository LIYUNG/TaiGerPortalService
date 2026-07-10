// KeywordSetService methods are mostly thin pass-throughs to KeywordSetDAO;
// deleteKeywordSet additionally cleans up references via ProgramRequirementDAO.
// This is a UNIT test: both DAOs are mocked so no database is touched.
jest.mock('../../dao/keywordset.dao');
jest.mock('../../dao/programRequirement.dao');

import KeywordSetDAOModule from '../../dao/keywordset.dao';
import ProgramRequirementDAOModule from '../../dao/programRequirement.dao';
import KeywordSetService from '../../services/keywordsets';
import type { KeywordSet } from '../../dao/keywordset.dao.types';

// The DAOs are auto-mocked above; re-type each as a bag of jest.Mock methods so
// the per-test `.mockResolvedValue()/.mockRejectedValue()` calls type-check
// while still allowing partial (non-Mongoose) return shapes.
type MockedDAO = Record<string, jest.Mock>;
const KeywordSetDAO = KeywordSetDAOModule as unknown as MockedDAO;
const ProgramRequirementDAO =
  ProgramRequirementDAOModule as unknown as MockedDAO;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('KeywordSetService — KeywordSetDAO delegators (mocked DAO)', () => {
  it('getKeywordSets delegates to DAO.getKeywordSets', async () => {
    const daoResult = [{ _id: 'k1' }, { _id: 'k2' }];
    KeywordSetDAO.getKeywordSets.mockResolvedValue(daoResult);

    const result = await KeywordSetService.getKeywordSets();

    expect(KeywordSetDAO.getKeywordSets).toHaveBeenCalledTimes(1);
    expect(KeywordSetDAO.getKeywordSets).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });

  it('findKeywordSet delegates to DAO.findKeywordSet with the match input', async () => {
    const match = {
      keywords: { zh: ['a'], en: ['b'] },
      antiKeywords: { zh: ['c'], en: ['d'] }
    };
    const daoResult = { _id: 'k1' };
    KeywordSetDAO.findKeywordSet.mockResolvedValue(daoResult);

    const result = await KeywordSetService.findKeywordSet(match);

    expect(KeywordSetDAO.findKeywordSet).toHaveBeenCalledTimes(1);
    expect(KeywordSetDAO.findKeywordSet).toHaveBeenCalledWith(match);
    expect(result).toBe(daoResult);
  });

  it('createKeywordSet delegates to DAO.createKeywordSet with fields', async () => {
    const fields = { name: 'math', keywords: ['algebra'] };
    const daoResult = { _id: 'k1', ...fields };
    KeywordSetDAO.createKeywordSet.mockResolvedValue(daoResult);

    const result = await KeywordSetService.createKeywordSet(
      fields as unknown as Partial<KeywordSet>
    );

    expect(KeywordSetDAO.createKeywordSet).toHaveBeenCalledTimes(1);
    expect(KeywordSetDAO.createKeywordSet).toHaveBeenCalledWith(fields);
    expect(result).toBe(daoResult);
  });

  it('updateKeywordSetById delegates to DAO.updateKeywordSetById with id+fields', async () => {
    const fields = { name: 'physics' };
    const daoResult = { _id: 'k1', name: 'physics' };
    KeywordSetDAO.updateKeywordSetById.mockResolvedValue(daoResult);

    const result = await KeywordSetService.updateKeywordSetById(
      'k1',
      fields as unknown as Partial<KeywordSet>
    );

    expect(KeywordSetDAO.updateKeywordSetById).toHaveBeenCalledTimes(1);
    expect(KeywordSetDAO.updateKeywordSetById).toHaveBeenCalledWith(
      'k1',
      fields
    );
    expect(result).toBe(daoResult);
  });
});

describe('KeywordSetService.deleteKeywordSet (mocked DAO)', () => {
  it('deletes the set, then removes its references from program requirements', async () => {
    KeywordSetDAO.deleteKeywordSetById.mockResolvedValue({ deletedCount: 1 });
    ProgramRequirementDAO.removeKeywordSetReferences.mockResolvedValue({
      modifiedCount: 3
    });

    const result = await KeywordSetService.deleteKeywordSet('k1');

    expect(KeywordSetDAO.deleteKeywordSetById).toHaveBeenCalledTimes(1);
    expect(KeywordSetDAO.deleteKeywordSetById).toHaveBeenCalledWith('k1');
    expect(
      ProgramRequirementDAO.removeKeywordSetReferences
    ).toHaveBeenCalledTimes(1);
    expect(
      ProgramRequirementDAO.removeKeywordSetReferences
    ).toHaveBeenCalledWith('k1');
    // No explicit return value from the service.
    expect(result).toBeUndefined();
  });

  it('does not remove references if the delete write rejects', async () => {
    KeywordSetDAO.deleteKeywordSetById.mockRejectedValue(new Error('boom'));

    await expect(KeywordSetService.deleteKeywordSet('k1')).rejects.toThrow(
      'boom'
    );

    expect(KeywordSetDAO.deleteKeywordSetById).toHaveBeenCalledTimes(1);
    expect(
      ProgramRequirementDAO.removeKeywordSetReferences
    ).not.toHaveBeenCalled();
  });
});
