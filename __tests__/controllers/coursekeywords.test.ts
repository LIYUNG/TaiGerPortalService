// Controller UNIT test for controllers/coursekeywords.
//
// The handlers are plain (req, res, next) functions, so we call them DIRECTLY
// with fake req/res/next and a mocked KeywordSetService. No route, no
// middleware, no database — only the controller's own responsibilities:
//   - what it pulls off req (params/body),
//   - the args it forwards to the service,
//   - the status + body it writes to res,
//   - that it forwards a service error to next().
// Route + middleware wiring is covered by __tests__/integration/coursekeywords.test.js.

jest.mock('../../services/keywordsets');

import KeywordSetServiceModule from '../../services/keywordsets';
import CoursekeywordsController from '../../controllers/coursekeywords';
import { mockReq, mockRes } from '../helpers/httpMocks';

// Auto-mocked module methods expose jest.fn()s at runtime, but TS still sees
// the real signatures. Re-type as a bag of jest.Mock methods so the per-test
// `.mockResolvedValue()/.mockRejectedValue()` calls type-check.
type MockedModule = Record<string, jest.Mock>;
const KeywordSetService = KeywordSetServiceModule as unknown as MockedModule;

// The controller module uses `export =`, so its members are destructured off
// the default-imported object; the handlers themselves are asyncHandler-wrapped
// (req, res) functions, but tests call them with an extra `next` arg for the
// forward-to-next() cases, so re-type each as a variadic handler.
type ControllerHandler = (...args: unknown[]) => Promise<unknown>;
const { getKeywordSets, createKeywordSet, updateKeywordSet, deleteKeywordSet } =
  CoursekeywordsController as unknown as Record<string, ControllerHandler>;

const keywordsSetId = '5f9f1b9b9b9b9b9b9b9b9b9b';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getKeywordSets', () => {
  it('responds with the keyword sets from the service', async () => {
    const sets = [{ _id: 'k1', categoryName: 'Math' }];
    KeywordSetService.getKeywordSets.mockResolvedValue(sets);
    const res = mockRes();

    await getKeywordSets(mockReq(), res, jest.fn());

    expect(KeywordSetService.getKeywordSets).toHaveBeenCalledTimes(1);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: sets });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    KeywordSetService.getKeywordSets.mockRejectedValue(err);
    const next = jest.fn();

    await getKeywordSets(mockReq(), mockRes(), next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('createKeywordSet', () => {
  const body = {
    categoryName: 'categoryName_new',
    description: 'desc',
    keywords: { zh: ['123'], en: ['abc'] },
    antiKeywords: { zh: ['123'], en: ['abc'] }
  };

  it('creates a set when there is no duplicate and responds 201 with it', async () => {
    KeywordSetService.findKeywordSet.mockResolvedValue(null);
    const created = { _id: 'new1', categoryName: 'categoryName_new' };
    KeywordSetService.createKeywordSet.mockResolvedValue(created);
    const res = mockRes();

    await createKeywordSet(
      mockReq({ params: { keywordsSetId }, body }),
      res,
      jest.fn()
    );

    expect(KeywordSetService.createKeywordSet).toHaveBeenCalledWith(
      expect.objectContaining({ categoryName: 'categoryName_new' })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: created });
  });

  it('forwards a 423 ErrorResponse to next() when a duplicate exists', async () => {
    KeywordSetService.findKeywordSet.mockResolvedValue({
      keywords: { zh: ['123'], en: ['abc'] },
      antiKeywords: { zh: ['123'], en: ['abc'] }
    });
    const next = jest.fn();

    await createKeywordSet(
      mockReq({ params: { keywordsSetId }, body }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 423 });
    expect(KeywordSetService.createKeywordSet).not.toHaveBeenCalled();
  });
});

describe('updateKeywordSet', () => {
  it('forwards id + fields (stamped with updatedAt) and responds 200 with the result', async () => {
    const updated = {
      _id: keywordsSetId,
      categoryName: 'categoryName_updated'
    };
    KeywordSetService.updateKeywordSetById.mockResolvedValue(updated);
    const res = mockRes();

    await updateKeywordSet(
      mockReq({
        params: { keywordsSetId },
        body: { categoryName: 'categoryName_updated' }
      }),
      res,
      jest.fn()
    );

    expect(KeywordSetService.updateKeywordSetById).toHaveBeenCalledWith(
      keywordsSetId,
      expect.objectContaining({
        categoryName: 'categoryName_updated',
        updatedAt: expect.any(Date)
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: updated });
  });

  it('forwards a 404 ErrorResponse to next() when the set is not found', async () => {
    KeywordSetService.updateKeywordSetById.mockResolvedValue(null);
    const next = jest.fn();

    await updateKeywordSet(
      mockReq({ params: { keywordsSetId }, body: { categoryName: 'x' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
  });
});

describe('deleteKeywordSet', () => {
  it('deletes the set, forwards the id and responds 200', async () => {
    KeywordSetService.deleteKeywordSet.mockResolvedValue(undefined);
    const res = mockRes();

    await deleteKeywordSet(
      mockReq({ params: { keywordsSetId } }),
      res,
      jest.fn()
    );

    expect(KeywordSetService.deleteKeywordSet).toHaveBeenCalledWith(
      keywordsSetId
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('boom');
    KeywordSetService.deleteKeywordSet.mockRejectedValue(err);
    const next = jest.fn();

    await deleteKeywordSet(
      mockReq({ params: { keywordsSetId } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});
