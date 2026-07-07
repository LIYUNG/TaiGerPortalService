// Controller UNIT test for controllers/admissions.
//
// The admissions handlers are plain (req, res, next) functions (wrapped by
// asyncHandler), so we call them DIRECTLY with fake req/res/next, a mocked
// ApplicationService / StudentService and a mocked S3 helper. No route, no
// middleware, no database. We assert ONLY the controller's own work: the filter
// it builds (via the real ApplicationQueryBuilder) and forwards to the service,
// the status + body it writes, the streaming headers, and that a service error
// is forwarded to next(). Full-stack wiring lives in
// __tests__/integration/admissions.test.js.

jest.mock('../../services/applications');
jest.mock('../../services/students');
jest.mock('../../aws/s3');

import ApplicationService from '../../services/applications';
import StudentService from '../../services/students';
import { getS3Object } from '../../aws/s3';
import {
  getAdmissionsOverview,
  getAdmissionsProgramCounts,
  getAdmissionLetter,
  getAdmissionsYear
} from '../../controllers/admissions';
import { mockReq, mockRes } from '../helpers/httpMocks';
import { student } from '../mock/user';

const studentId = student._id.toString();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getAdmissionsOverview', () => {
  it('responds 200 with the admission status counts from the service', async () => {
    const counts = { admission: 2, rejection: 1, pending: 4 };
    ApplicationService.getAdmissionsStatusCounts.mockResolvedValue(counts);
    const res = mockRes();

    await getAdmissionsOverview(mockReq(), res, jest.fn());

    expect(ApplicationService.getAdmissionsStatusCounts).toHaveBeenCalledTimes(
      1
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: counts });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    ApplicationService.getAdmissionsStatusCounts.mockRejectedValue(err);
    const next = jest.fn();

    await getAdmissionsOverview(mockReq(), mockRes(), next);

    // The controller calls the service directly, so asyncHandler forwards the
    // raw error to next() untouched.
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('getAdmissionsProgramCounts', () => {
  // Returns only the per-program application counts; the paginated applications
  // list is served by getStudentsApplicationsPaginated.
  it('200: returns the program application counts', async () => {
    const result = [{ programId: 'p1', count: 3 }];
    ApplicationService.getProgramApplicationCounts.mockResolvedValue(result);

    const res = mockRes();

    await getAdmissionsProgramCounts(mockReq(), res, jest.fn());

    expect(
      ApplicationService.getProgramApplicationCounts
    ).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, result });
  });

  it('200: defaults result to [] when the service resolves nullish', async () => {
    ApplicationService.getProgramApplicationCounts.mockResolvedValue(null);
    const res = mockRes();

    await getAdmissionsProgramCounts(mockReq(), res, jest.fn());

    expect(res.send).toHaveBeenCalledWith({ success: true, result: [] });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    ApplicationService.getProgramApplicationCounts.mockRejectedValue(err);
    const next = jest.fn();

    await getAdmissionsProgramCounts(mockReq(), mockRes(), next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('getAdmissionsYear', () => {
  it('200: forwards student_id = applications_year to findStudents', async () => {
    const tasks = [{ _id: 's1', student_id: '2024' }];
    StudentService.findStudents.mockResolvedValue(tasks);
    const req = mockReq({ params: { applications_year: '2024' } });
    const res = mockRes();

    await getAdmissionsYear(req, res, jest.fn());

    expect(StudentService.findStudents).toHaveBeenCalledWith({
      student_id: '2024'
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: tasks });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    StudentService.findStudents.mockRejectedValue(err);
    const next = jest.fn();

    await getAdmissionsYear(
      mockReq({ params: { applications_year: '2024' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('getAdmissionLetter', () => {
  it('streams the S3 object as an attachment with the right key', async () => {
    const buffer = Buffer.from('pdf bytes');
    getS3Object.mockResolvedValue(buffer);
    const fileName = 'offer_letter.pdf';
    const req = mockReq({ params: { studentId, fileName } });
    const res = mockRes();
    res.attachment = jest.fn(() => res);
    res.setHeader = jest.fn(() => res);

    await getAdmissionLetter(req, res, jest.fn());

    expect(getS3Object).toHaveBeenCalledWith(
      expect.any(String),
      `${studentId}/admission/${fileName}`
    );
    expect(res.attachment).toHaveBeenCalledWith(encodeURIComponent(fileName));
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('attachment')
    );
    expect(res.end).toHaveBeenCalledWith(buffer);
  });

  it('forwards an S3 error to next()', async () => {
    const err = new Error('s3 down');
    getS3Object.mockRejectedValue(err);
    const res = mockRes();
    res.attachment = jest.fn(() => res);
    res.setHeader = jest.fn(() => res);
    const next = jest.fn();

    await getAdmissionLetter(
      mockReq({ params: { studentId, fileName: 'x.pdf' } }),
      res,
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});
