// UNIT test for controllers/cv_draft. Every external boundary is mocked (student
// + thread services, the CV skill, the docx renderer, S3). Handlers are
// asyncHandler-wrapped and take (req, res); rejections surface via the awaited
// promise (asyncHandler forwards to `next`, which is undefined here).

jest.mock('../../services/students');
jest.mock('../../services/documentthreads');
jest.mock('../../services/permissions');
jest.mock('../../services/ai-assist/cv');
jest.mock('../../services/ai-assist/cv/render', () => ({
  renderCVDraftDocx: jest.fn(() => Buffer.from('DOCX'))
}));
jest.mock('../../aws/s3', () => ({
  getS3Object: jest.fn(),
  putS3Object: jest.fn()
}));

import cvDraftController from '../../controllers/cv_draft';
import StudentService from '../../services/students';
import DocumentThreadService from '../../services/documentthreads';
import cvService from '../../services/ai-assist/cv';
import { renderCVDraftDocx } from '../../services/ai-assist/cv/render';
import { getS3Object, putS3Object } from '../../aws/s3';

const asMock = (fn: unknown) => fn as jest.Mock;
const user = { _id: { toString: () => 'u1' } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRes = (): any => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {};
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  res.setHeader = jest.fn(() => res);
  return res;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockReq = (o: Record<string, unknown> = {}): any => ({
  params: {},
  query: {},
  body: {},
  headers: {},
  ...o
});

const SAMPLE_DRAFT = { personal: { fullName: 'A' } };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('generateCvDraft', () => {
  it('generates, persists to the thread and returns the result', async () => {
    asMock(StudentService.getStudentByIdLean).mockResolvedValue({ _id: 's1' });
    asMock(DocumentThreadService.getThreadByIdLean).mockResolvedValue({
      additional_information: 'ctx'
    });
    asMock(cvService.createCVDraft).mockResolvedValue({ draft: SAMPLE_DRAFT });
    const res = mockRes();
    await cvDraftController.generateCvDraft(
      mockReq({ params: { studentId: 's1' }, body: { documentsthreadId: 't1' }, user }),
      res
    );
    expect(cvService.createCVDraft).toHaveBeenCalled();
    expect(DocumentThreadService.updateThreadById).toHaveBeenCalledWith('t1', {
      cv_draft: { draft: SAMPLE_DRAFT }
    });
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: { draft: SAMPLE_DRAFT }
    });
  });

  it('404s when the student is missing', async () => {
    asMock(StudentService.getStudentByIdLean).mockResolvedValue(null);
    await expect(
      cvDraftController.generateCvDraft(
        mockReq({ params: { studentId: 'x' }, body: {}, user }),
        mockRes()
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('updateAdditionalInformation', () => {
  it('persists and echoes the value', async () => {
    asMock(DocumentThreadService.updateThreadById).mockResolvedValue({ _id: 't1' });
    const res = mockRes();
    await cvDraftController.updateAdditionalInformation(
      mockReq({ params: { messagesThreadId: 't1' }, body: { additionalInformation: 'hi' } }),
      res
    );
    expect(DocumentThreadService.updateThreadById).toHaveBeenCalledWith('t1', {
      additional_information: 'hi'
    });
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: { additionalInformation: 'hi' }
    });
  });

  it('404s when the thread is missing', async () => {
    asMock(DocumentThreadService.updateThreadById).mockResolvedValue(null);
    await expect(
      cvDraftController.updateAdditionalInformation(
        mockReq({ params: { messagesThreadId: 'x' }, body: {} }),
        mockRes()
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('renderCvDraft', () => {
  it('renders, embeds the photo, uploads to S3 and attaches to the thread', async () => {
    asMock(StudentService.getStudentByIdLean).mockResolvedValue({
      firstname: 'Wei',
      lastname: 'Chen',
      profile: [{ name: 'Passport_Photo', path: 's1/photo.jpg' }]
    });
    asMock(getS3Object).mockResolvedValue(new Uint8Array([1, 2, 3]));
    const save = jest.fn().mockResolvedValue(undefined);
    asMock(DocumentThreadService.getThreadDocById).mockResolvedValue({
      messages: [],
      save
    });
    const res = mockRes();
    await cvDraftController.renderCvDraft(
      mockReq({
        params: { studentId: 's1' },
        body: { draft: SAMPLE_DRAFT, documentsthreadId: 't1' },
        user
      }),
      res
    );
    expect(getS3Object).toHaveBeenCalledWith(expect.anything(), 's1/photo.jpg');
    expect(renderCVDraftDocx).toHaveBeenCalled();
    expect(putS3Object).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  it('400s without a draft', async () => {
    await expect(
      cvDraftController.renderCvDraft(
        mockReq({ params: { studentId: 's1' }, body: { documentsthreadId: 't1' }, user }),
        mockRes()
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('renders without a photo when the student has none', async () => {
    asMock(StudentService.getStudentByIdLean).mockResolvedValue({
      firstname: 'A',
      profile: []
    });
    asMock(DocumentThreadService.getThreadDocById).mockResolvedValue({
      messages: [],
      save: jest.fn().mockResolvedValue(undefined)
    });
    await cvDraftController.renderCvDraft(
      mockReq({
        params: { studentId: 's1' },
        body: { draft: SAMPLE_DRAFT, documentsthreadId: 't1' },
        user
      }),
      mockRes()
    );
    expect(getS3Object).not.toHaveBeenCalled();
    expect(renderCVDraftDocx).toHaveBeenCalledWith(SAMPLE_DRAFT, undefined);
  });
});

describe('getSavedCvDraft', () => {
  it('returns the persisted draft', async () => {
    asMock(DocumentThreadService.getThreadByIdLean).mockResolvedValue({
      cv_draft: { draft: SAMPLE_DRAFT }
    });
    const res = mockRes();
    await cvDraftController.getSavedCvDraft(
      mockReq({ params: { documentsthreadId: 't1' } }),
      res
    );
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: { draft: SAMPLE_DRAFT }
    });
  });

  it('returns null when no draft is saved', async () => {
    asMock(DocumentThreadService.getThreadByIdLean).mockResolvedValue({});
    const res = mockRes();
    await cvDraftController.getSavedCvDraft(
      mockReq({ params: { documentsthreadId: 't1' } }),
      res
    );
    expect(res.send).toHaveBeenCalledWith({ success: true, data: null });
  });
});

describe('downloadCvDraft', () => {
  it('streams the docx with attachment headers', async () => {
    asMock(StudentService.getStudentByIdLean).mockResolvedValue({
      firstname: 'A',
      profile: []
    });
    const res = mockRes();
    await cvDraftController.downloadCvDraft(
      mockReq({ params: { studentId: 's1' }, body: { draft: SAMPLE_DRAFT } }),
      res
    );
    expect(renderCVDraftDocx).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('attachment')
    );
    expect(res.send).toHaveBeenCalled();
  });

  it('400s without a draft', async () => {
    await expect(
      cvDraftController.downloadCvDraft(
        mockReq({ params: { studentId: 's1' }, body: {} }),
        mockRes()
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
