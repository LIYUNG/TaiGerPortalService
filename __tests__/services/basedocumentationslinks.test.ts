// BasedocumentationslinkService methods are thin pass-throughs to
// BasedocumentationslinkDAO. This is a UNIT test: the DAO is mocked so no
// database (in-memory or otherwise) is touched. Each test asserts the service
// delegates to the right DAO method with the exact args and returns the DAO's
// (mocked) value.
jest.mock('../../dao/basedocumentationslink.dao');

import BasedocumentationslinkDAOModule from '../../dao/basedocumentationslink.dao';
import BasedocumentationslinkService from '../../services/basedocumentationslinks';

// Auto-mocked DAO exposes jest.fn()s at runtime, but TS still sees the real
// signatures. Re-type it as a bag of jest.Mock methods so the per-test
// `.mockReturnValue()` calls type-check.
type MockedDAO = Record<string, jest.Mock>;
const BasedocumentationslinkDAO =
  BasedocumentationslinkDAOModule as unknown as MockedDAO;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('BasedocumentationslinkService.findByCategory (mocked DAO)', () => {
  it('delegates to DAO.findByCategory with category and returns its result', () => {
    const daoResult = [{ _id: 'l1', category: 'survey' }];
    BasedocumentationslinkDAO.findByCategory.mockReturnValue(daoResult);

    const result = BasedocumentationslinkService.findByCategory('survey');

    expect(BasedocumentationslinkDAO.findByCategory).toHaveBeenCalledTimes(1);
    expect(BasedocumentationslinkDAO.findByCategory).toHaveBeenCalledWith(
      'survey'
    );
    expect(result).toBe(daoResult);
  });
});

describe('BasedocumentationslinkService.upsertByCategoryKey (mocked DAO)', () => {
  it('delegates to DAO.upsertByCategoryKey with category+key+set and returns its result', () => {
    const set = { link: 'https://example.com' };
    const daoResult = { _id: 'l2', category: 'survey', key: 'k1', ...set };
    BasedocumentationslinkDAO.upsertByCategoryKey.mockReturnValue(daoResult);

    const result = BasedocumentationslinkService.upsertByCategoryKey(
      'survey',
      'k1',
      set
    );

    expect(BasedocumentationslinkDAO.upsertByCategoryKey).toHaveBeenCalledTimes(
      1
    );
    expect(BasedocumentationslinkDAO.upsertByCategoryKey).toHaveBeenCalledWith(
      'survey',
      'k1',
      set
    );
    expect(result).toBe(daoResult);
  });
});
