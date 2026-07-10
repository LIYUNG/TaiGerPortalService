// Controller UNIT test for controllers/programChangeRequests.
//
// The handlers are plain (req, res, next) functions (wrapped by asyncHandler),
// so we call them DIRECTLY with fake req/res/next and the service layer
// (ProgramChangeRequestService/ProgramService) mocked. No route, no middleware,
// no DB — only the controller's own work: the args it forwards, the not-found /
// already-reviewed guards, the status + body it writes, and that a service error
// is forwarded to next(). Full-stack coverage (route -> service -> dao ->
// in-memory Mongo) lives in __tests__/integration/programChangeRequests.test.js.

jest.mock('../../services/programChangeRequests');
jest.mock('../../services/programs');

import ProgramChangeRequestServiceModule from '../../services/programChangeRequests';
import ProgramServiceModule from '../../services/programs';
import ProgramChangeRequestsController from '../../controllers/programChangeRequests';
import { mockReq, mockRes } from '../helpers/httpMocks';
import { admin } from '../mock/user';

// Auto-mocked module methods expose jest.fn()s at runtime, but TS still sees
// the real signatures. Re-type as a bag of jest.Mock methods so the per-test
// `.mockResolvedValue()/.mockRejectedValue()` calls type-check.
type MockedModule = Record<string, jest.Mock>;
const ProgramChangeRequestService =
  ProgramChangeRequestServiceModule as unknown as MockedModule;
const ProgramService = ProgramServiceModule as unknown as MockedModule;

// The controller module uses `export =`, so its members are destructured off
// the default-imported object; the handlers themselves are asyncHandler-wrapped
// (req, res) functions, but tests call them with an extra `next` arg for the
// forward-to-next() cases, so re-type each as a variadic handler.
type ControllerHandler = (...args: unknown[]) => Promise<unknown>;
const {
  getProgramChangeRequests,
  submitProgramChangeRequests,
  reviewProgramChangeRequest
} = ProgramChangeRequestsController as unknown as Record<
  string,
  ControllerHandler
>;

const programId = 'prog-1';
const requestId = 'req-1';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getProgramChangeRequests', () => {
  it('responds with the open change requests and forwards req.params.programId', async () => {
    const changeRequests = [{ _id: 'cr1' }, { _id: 'cr2' }];
    ProgramChangeRequestService.getOpenChangeRequestsByProgramId.mockResolvedValue(
      changeRequests
    );
    const res = mockRes();

    await getProgramChangeRequests(
      mockReq({ params: { programId } }),
      res,
      jest.fn()
    );

    expect(
      ProgramChangeRequestService.getOpenChangeRequestsByProgramId
    ).toHaveBeenCalledWith(programId);
    // This handler uses res.send(...) without a preceding res.status().
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: changeRequests
    });
  });

  it('forwards a 404 ErrorResponse to next() when the service resolves nothing', async () => {
    ProgramChangeRequestService.getOpenChangeRequestsByProgramId.mockResolvedValue(
      null
    );
    const next = jest.fn();

    await getProgramChangeRequests(
      mockReq({ params: { programId } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });
});

describe('submitProgramChangeRequests', () => {
  it('upserts the change request for an existing program and responds success', async () => {
    ProgramService.getProgramByIdLean.mockResolvedValue({ _id: programId });
    ProgramChangeRequestService.upsertChangeRequest.mockResolvedValue({});
    const changes = { program_name: 'Updated Program Name' };
    const res = mockRes();

    await submitProgramChangeRequests(
      mockReq({ params: { programId }, body: changes, user: admin }),
      res,
      jest.fn()
    );

    expect(ProgramService.getProgramByIdLean).toHaveBeenCalledWith(programId);
    expect(
      ProgramChangeRequestService.upsertChangeRequest
    ).toHaveBeenCalledWith(programId, admin._id, changes);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });

  it('forwards a 404 ErrorResponse to next() when the program does not exist', async () => {
    ProgramService.getProgramByIdLean.mockResolvedValue(null);
    const next = jest.fn();

    await submitProgramChangeRequests(
      mockReq({ params: { programId }, body: {}, user: admin }),
      mockRes(),
      next
    );

    expect(
      ProgramChangeRequestService.upsertChangeRequest
    ).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });
});

describe('reviewProgramChangeRequest', () => {
  it('marks an open change request as reviewed by the current user', async () => {
    ProgramChangeRequestService.getChangeRequestById.mockResolvedValue({
      _id: requestId,
      reviewedBy: undefined
    });
    const updated = { _id: requestId, reviewedBy: admin._id };
    ProgramChangeRequestService.updateChangeRequestById.mockResolvedValue(
      updated
    );
    const res = mockRes();

    await reviewProgramChangeRequest(
      mockReq({ params: { requestId }, user: admin }),
      res,
      jest.fn()
    );

    expect(
      ProgramChangeRequestService.getChangeRequestById
    ).toHaveBeenCalledWith(requestId);
    expect(
      ProgramChangeRequestService.updateChangeRequestById
    ).toHaveBeenCalledWith(
      requestId,
      expect.objectContaining({
        reviewedBy: admin._id,
        reviewedAt: expect.any(Date)
      })
    );
    expect(res.send).toHaveBeenCalledWith({ success: true, data: updated });
  });

  it('forwards a 404 ErrorResponse to next() when the change request is not found', async () => {
    ProgramChangeRequestService.getChangeRequestById.mockResolvedValue(null);
    const next = jest.fn();

    await reviewProgramChangeRequest(
      mockReq({ params: { requestId }, user: admin }),
      mockRes(),
      next
    );

    expect(
      ProgramChangeRequestService.updateChangeRequestById
    ).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('forwards a 400 ErrorResponse to next() when the change request was already reviewed', async () => {
    ProgramChangeRequestService.getChangeRequestById.mockResolvedValue({
      _id: requestId,
      reviewedBy: admin._id
    });
    const next = jest.fn();

    await reviewProgramChangeRequest(
      mockReq({ params: { requestId }, user: admin }),
      mockRes(),
      next
    );

    expect(
      ProgramChangeRequestService.updateChangeRequestById
    ).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });
});
