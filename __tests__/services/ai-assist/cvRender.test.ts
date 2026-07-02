// UNIT test for services/ai-assist/cv/render (Stage B docx rendering).
// docxtemplater / pizzip / the image module are mocked, and the template is
// loaded from S3 via TemplateService + getS3Object (both mocked) — so NOTHING
// real is compiled or fetched. We assert the data mapping, the returned buffer,
// and the S3 template-loading / caching behaviour.

const mockRender = jest.fn();
const mockGenerate = jest.fn(() => Buffer.from('DOCX-BYTES'));
const mockDocInstances: Array<Record<string, unknown>> = [];

const mockGetTemplateByCategory = jest.fn();
const mockGetS3Object = jest.fn();
const mockCacheGet = jest.fn();
const mockCacheSet = jest.fn();

jest.mock('docxtemplater', () =>
  jest.fn().mockImplementation((_zip, opts) => {
    const inst = {
      opts,
      render: mockRender,
      getZip: () => ({ generate: mockGenerate })
    };
    mockDocInstances.push(inst);
    return inst;
  })
);
jest.mock('pizzip', () =>
  jest.fn().mockImplementation((buf) => ({ _buf: buf }))
);
jest.mock('docxtemplater-image-module-free', () =>
  jest.fn().mockImplementation((o) => ({ _image: true, ...o }))
);
jest.mock('../../../services/templates', () => ({
  __esModule: true,
  default: {
    getTemplateByCategory: (...args: unknown[]) =>
      mockGetTemplateByCategory(...args)
  }
}));
jest.mock('../../../aws/s3', () => ({
  getS3Object: (...args: unknown[]) => mockGetS3Object(...args)
}));
jest.mock('../../../config', () => ({
  AWS_S3_PUBLIC_BUCKET_NAME: 'test-public-bucket'
}));
jest.mock('../../../cache/node-cache', () => ({
  ten_minutes_cache: {
    get: (...args: unknown[]) => mockCacheGet(...args),
    set: (...args: unknown[]) => mockCacheSet(...args)
  }
}));

import { renderCVDraftDocx } from '../../../services/ai-assist/cv/render';
import { emptyCVDraft } from '../../../services/ai-assist/cv/types';

beforeEach(() => {
  jest.clearAllMocks();
  mockDocInstances.length = 0;
  // Default: template found in S3, cache miss -> fetch the bytes.
  mockGetTemplateByCategory.mockResolvedValue({
    path: 'templates/cv_template.docx'
  });
  mockCacheGet.mockReturnValue(undefined);
  mockGetS3Object.mockResolvedValue(new Uint8Array([80, 75])); // "PK"
});

describe('renderCVDraftDocx', () => {
  it('returns the generated nodebuffer', async () => {
    const out = await renderCVDraftDocx(emptyCVDraft());
    expect(out.toString()).toBe('DOCX-BYTES');
    expect(mockRender).toHaveBeenCalledTimes(1);
    expect(mockGenerate).toHaveBeenCalledWith({ type: 'nodebuffer' });
  });

  it('loads the template from S3 (public bucket) and caches it', async () => {
    await renderCVDraftDocx(emptyCVDraft());
    expect(mockGetTemplateByCategory).toHaveBeenCalledWith(
      'CV_AI_Draft_Template'
    );
    expect(mockGetS3Object).toHaveBeenCalledWith(
      'test-public-bucket',
      'templates/cv_template.docx'
    );
    expect(mockCacheSet).toHaveBeenCalledWith(
      'templates/cv_template.docx',
      expect.any(Buffer)
    );
  });

  it('serves the cached template without hitting S3', async () => {
    mockCacheGet.mockReturnValue(Buffer.from('CACHED'));
    await renderCVDraftDocx(emptyCVDraft());
    expect(mockGetS3Object).not.toHaveBeenCalled();
    expect(mockCacheSet).not.toHaveBeenCalled();
  });

  it('throws when the template is not configured in S3', async () => {
    mockGetTemplateByCategory.mockResolvedValue(null);
    await expect(renderCVDraftDocx(emptyCVDraft())).rejects.toThrow(
      'CV_AI_Draft_Template'
    );
    expect(mockGetS3Object).not.toHaveBeenCalled();
  });

  it('flattens personal fields to the top level and marks hasPhoto=false without a photo', async () => {
    const draft = emptyCVDraft();
    draft.personal.fullName = 'Wei-Ting Chen';
    await renderCVDraftDocx(draft);
    const data = mockRender.mock.calls[0][0] as Record<string, unknown>;
    expect(data.fullName).toBe('Wei-Ting Chen');
    expect(data.hasPhoto).toBe(false);
    expect(data.universities).toEqual([]);
  });

  it('marks hasPhoto=true and passes the photo buffer when provided', async () => {
    const photo = Buffer.from([1, 2, 3]);
    await renderCVDraftDocx(emptyCVDraft(), photo);
    const data = mockRender.mock.calls[0][0] as Record<string, unknown>;
    expect(data.hasPhoto).toBe(true);
    expect(data.photo).toBe(photo);
  });

  it('treats an empty photo buffer as no photo', async () => {
    await renderCVDraftDocx(emptyCVDraft(), Buffer.alloc(0));
    const data = mockRender.mock.calls[0][0] as Record<string, unknown>;
    expect(data.hasPhoto).toBe(false);
  });
});
