// Controller UNIT test for controllers/student_applications.
//
// This controller owns a single handler, getApplicationConflicts, a plain
// (req, res, next) function. We call it DIRECTLY with fake req/res/next and
// ApplicationService mocked, and assert ONLY the controller's own work: the
// status it sets, the body shape, and that it forwards a service error to
// next(). No route, no middleware, no DB.
//
// NOTE: the sibling route /deltas is served by controllers/teams.getApplicationDeltas
// (covered in __tests__/controllers/teams.test.js), so it is intentionally not
// re-tested here. The real aggregation runs against an in-memory DB in
// __tests__/integration/student_applications.test.js.

jest.mock('../../services/applications');

import ApplicationService from '../../services/applications';
import { getApplicationConflicts } from '../../controllers/student_applications';
import { mockReq, mockRes } from '../helpers/httpMocks';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getApplicationConflicts', () => {
  it('responds 200 with the conflicts the service resolves', async () => {
    const conflicts = [
      { _id: 'p1', applicationCount: 2, students: [{ _id: 's1' }] }
    ];
    ApplicationService.getApplicationConflicts.mockResolvedValue(conflicts);
    const res = mockRes();

    await getApplicationConflicts(mockReq(), res, jest.fn());

    expect(ApplicationService.getApplicationConflicts).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: conflicts });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    ApplicationService.getApplicationConflicts.mockRejectedValue(err);
    const next = jest.fn();

    await getApplicationConflicts(mockReq(), mockRes(), next);

    expect(next).toHaveBeenCalledWith(err);
  });
});
