// UNIT test for services/ai-assist/cv/render (Stage B docx rendering via
// easy-template-x). The template engine, S3 template fetch and cache are all
// mocked — NOTHING real is compiled or fetched. We assert the data mapping, the
// returned buffer, S3 template-loading/caching, and passport-photo embedding
// (magic-byte format detection for common image formats).

const mockProcess = jest.fn(() => Buffer.from('DOCX-BYTES'));

const mockGetTemplateByCategory = jest.fn();
const mockGetS3Object = jest.fn();
const mockCacheGet = jest.fn();
const mockCacheSet = jest.fn();
const mockHeadETag = jest.fn();

jest.mock('easy-template-x', () => ({
  TemplateHandler: jest.fn().mockImplementation(() => ({
    process: mockProcess
  })),
  MimeType: {
    Png: 'image/png',
    Jpeg: 'image/jpeg',
    Gif: 'image/gif',
    Bmp: 'image/bmp',
    Svg: 'image/svg+xml'
  }
}));
jest.mock('../../../services/templates', () => ({
  __esModule: true,
  default: {
    getTemplateByCategory: (...args: unknown[]) =>
      mockGetTemplateByCategory(...args)
  }
}));
jest.mock('../../../aws/s3', () => ({
  getS3Object: (...args: unknown[]) => mockGetS3Object(...args),
  headS3ObjectETag: (...args: unknown[]) => mockHeadETag(...args)
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

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const BMP = Buffer.from([0x42, 0x4d, 0x00, 0x00]);
const UNKNOWN = Buffer.from([0x00, 0x01, 0x02, 0x03]);

const dataOf = () =>
  mockProcess.mock.calls[0][1] as Record<string, unknown>;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetTemplateByCategory.mockResolvedValue({
    path: 'templates/cv_template.docx'
  });
  mockCacheGet.mockReturnValue(undefined);
  mockGetS3Object.mockResolvedValue(new Uint8Array([80, 75])); // "PK"
  mockHeadETag.mockResolvedValue('"etag-1"');
});

describe('renderCVDraftDocx', () => {
  it('returns the processed docx buffer', async () => {
    const out = await renderCVDraftDocx(emptyCVDraft());
    expect(out.buffer.toString()).toBe('DOCX-BYTES');
    expect(out.photoEmbedded).toBe(false);
    expect(typeof out.templateVersion).toBe('string');
    expect(mockProcess).toHaveBeenCalledTimes(1);
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
      expect.stringContaining('templates/cv_template.docx'),
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
      'template has not been set up'
    );
    expect(mockGetS3Object).not.toHaveBeenCalled();
  });

  it('flattens personal fields to the top level', async () => {
    const draft = emptyCVDraft();
    draft.personal.fullName = 'Wei-Ting Chen';
    await renderCVDraftDocx(draft);
    const data = dataOf();
    expect(data.fullName).toBe('Wei-Ting Chen');
    expect(data.universities).toEqual([]);
    expect(data.photo).toBeUndefined();
  });

  it.each([
    ['PNG', PNG, 'image/png'],
    ['JPEG', JPEG, 'image/jpeg'],
    ['GIF', GIF, 'image/gif'],
    ['BMP', BMP, 'image/bmp']
  ])('embeds a %s photo with the detected format', async (_label, buf, mime) => {
    await renderCVDraftDocx(emptyCVDraft(), buf as Buffer);
    const photo = dataOf().photo as Record<string, unknown>;
    expect(photo).toMatchObject({
      _type: 'image',
      format: mime,
      source: buf
    });
    expect(photo.width).toBeGreaterThan(0);
    expect(photo.height).toBeGreaterThan(0);
  });

  it('skips a photo in an unsupported/unknown format', async () => {
    await renderCVDraftDocx(emptyCVDraft(), UNKNOWN);
    expect(dataOf().photo).toBeUndefined();
  });

  it('skips an empty photo buffer', async () => {
    await renderCVDraftDocx(emptyCVDraft(), Buffer.alloc(0));
    expect(dataOf().photo).toBeUndefined();
  });
});
