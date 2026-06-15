// VCService is a thin pass-through to VCDAO (../dao/vc.dao). This is a UNIT
// test: the DAO is mocked so no database (in-memory or otherwise) is touched.
// Each test asserts the service delegates to the right DAO method with the
// exact args and returns the DAO's result.
jest.mock('../../dao/vc.dao');

import VCDAO from '../../dao/vc.dao';
import VCService from '../../services/vs';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('VCService (mocked DAO)', () => {
  it('getVC delegates with filter and returns its result', async () => {
    const filter = { student_id: 's1' };
    const daoResult = { _id: 'vc1', student_id: 's1' };
    VCDAO.getVC.mockResolvedValue(daoResult);

    const result = await VCService.getVC(filter);

    expect(VCDAO.getVC).toHaveBeenCalledTimes(1);
    expect(VCDAO.getVC).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });

  it('pushChange delegates with filter + change and returns its result', async () => {
    const filter = { student_id: 's1' };
    const change = { $push: { messages: { text: 'hi' } } };
    const daoResult = { _id: 'vc1', student_id: 's1' };
    VCDAO.pushChange.mockResolvedValue(daoResult);

    const result = await VCService.pushChange(filter, change);

    expect(VCDAO.pushChange).toHaveBeenCalledTimes(1);
    expect(VCDAO.pushChange).toHaveBeenCalledWith(filter, change);
    expect(result).toBe(daoResult);
  });
});
