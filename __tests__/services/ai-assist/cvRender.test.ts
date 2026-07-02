// UNIT test for services/ai-assist/cv/render (Stage B docx rendering).
// docxtemplater / pizzip / the image module and the base64 template are all
// mocked, so NOTHING real is compiled — we assert the data mapping and that the
// generated buffer is returned.

const mockRender = jest.fn();
const mockGenerate = jest.fn(() => Buffer.from('DOCX-BYTES'));
const mockDocInstances: Array<Record<string, unknown>> = [];

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

import { renderCVDraftDocx } from '../../../services/ai-assist/cv/render';
import { emptyCVDraft } from '../../../services/ai-assist/cv/types';

beforeEach(() => {
  jest.clearAllMocks();
  mockDocInstances.length = 0;
});

describe('renderCVDraftDocx', () => {
  it('returns the generated nodebuffer', () => {
    const out = renderCVDraftDocx(emptyCVDraft());
    expect(out.toString()).toBe('DOCX-BYTES');
    expect(mockRender).toHaveBeenCalledTimes(1);
    expect(mockGenerate).toHaveBeenCalledWith({ type: 'nodebuffer' });
  });

  it('flattens personal fields to the top level and marks hasPhoto=false without a photo', () => {
    const draft = emptyCVDraft();
    draft.personal.fullName = 'Wei-Ting Chen';
    renderCVDraftDocx(draft);
    const data = mockRender.mock.calls[0][0] as Record<string, unknown>;
    expect(data.fullName).toBe('Wei-Ting Chen');
    expect(data.hasPhoto).toBe(false);
    expect(data.universities).toEqual([]);
  });

  it('marks hasPhoto=true and passes the photo buffer when provided', () => {
    const photo = Buffer.from([1, 2, 3]);
    renderCVDraftDocx(emptyCVDraft(), photo);
    const data = mockRender.mock.calls[0][0] as Record<string, unknown>;
    expect(data.hasPhoto).toBe(true);
    expect(data.photo).toBe(photo);
  });

  it('treats an empty photo buffer as no photo', () => {
    renderCVDraftDocx(emptyCVDraft(), Buffer.alloc(0));
    const data = mockRender.mock.calls[0][0] as Record<string, unknown>;
    expect(data.hasPhoto).toBe(false);
  });
});
