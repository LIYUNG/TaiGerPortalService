// Controller UNIT test for controllers/search (mounted by routes/searches).
//
// The handlers are plain (req, res, next) functions, so we call them DIRECTLY
// with fake req/res/next and SearchService mocked. We assert ONLY the
// controller's HTTP concerns: the status it sets, the response body shape, the
// argument it forwards (req.query.q), and the swallow-error-and-return-[] branch
// on getResults. No route, no middleware, no DB. Full-stack coverage (route ->
// service -> dao -> in-memory Mongo) lives in __tests__/integration/searches.test.js
// and the query/sort logic in __tests__/dao/search.dao.test.js.

jest.mock('../../services/search');

import SearchService from '../../services/search';
import {
  getQueryResults,
  getQueryStudentsResults,
  getQueryPublicResults
} from '../../controllers/search';
import { mockReq, mockRes } from '../helpers/httpMocks';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getQueryResults', () => {
  it('responds 200 with the service results and forwards req.query.q', async () => {
    const results = [
      { title: 'Top', score: 5 },
      { firstname: 'Mid', score: 2 }
    ];
    SearchService.getResults.mockResolvedValue(results);
    const res = mockRes();

    await getQueryResults(mockReq({ query: { q: 'test' } }), res, jest.fn());

    expect(SearchService.getResults).toHaveBeenCalledWith('test');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: results });
  });

  it('swallows a service error and responds 200 with an empty data array', async () => {
    SearchService.getResults.mockRejectedValue(new Error('index missing'));
    const res = mockRes();

    await getQueryResults(mockReq({ query: { q: 'boom' } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: [] });
  });
});

describe('getQueryStudentsResults', () => {
  it('responds 200 with the student results and forwards req.query.q', async () => {
    const students = [{ firstname: 'Jane', role: 'Student' }];
    SearchService.getStudentsResults.mockResolvedValue(students);
    const res = mockRes();

    await getQueryStudentsResults(
      mockReq({ query: { q: 'jane' } }),
      res,
      jest.fn()
    );

    expect(SearchService.getStudentsResults).toHaveBeenCalledWith('jane');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: students });
  });

  it('forwards a service error to next() (no swallow branch here)', async () => {
    const err = new Error('db down');
    SearchService.getStudentsResults.mockRejectedValue(err);
    const next = jest.fn();

    await getQueryStudentsResults(
      mockReq({ query: { q: 'jane' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('getQueryPublicResults', () => {
  it('responds 200 with the public results and forwards req.query.q', async () => {
    const docs = [{ title: 'Guide', score: 3 }];
    SearchService.getPublicResults.mockResolvedValue(docs);
    const res = mockRes();

    await getQueryPublicResults(
      mockReq({ query: { q: 'guide' } }),
      res,
      jest.fn()
    );

    expect(SearchService.getPublicResults).toHaveBeenCalledWith('guide');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: docs });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    SearchService.getPublicResults.mockRejectedValue(err);
    const next = jest.fn();

    await getQueryPublicResults(
      mockReq({ query: { q: 'guide' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});
