// UNIT test for controllers/cv_draft. Every external boundary is mocked (student
// + thread services, the CV skill, the docx renderer, S3). Handlers are
// asyncHandler-wrapped and take (req, res); rejections surface via the awaited
// promise (asyncHandler forwards to `next`, which is undefined here).

import crypto from 'crypto';

jest.mock('../../services/students');
jest.mock('../../services/documentthreads');
jest.mock('../../services/permissions');
jest.mock('../../services/ai-assist/cv');
jest.mock('../../services/ai-assist/cv/render', () => ({
  renderCVDraftDocx: jest.fn(() => ({
    buffer: Buffer.from('DOCX'),
    photoEmbedded: false,
    templateVersion: 'tpl-v1'
  })),
  getCvTemplateVersion: jest.fn(() => 'tpl-v1')
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
import PermissionService from '../../services/permissions';

const asMock = (fn: unknown) => fn as jest.Mock;
const user = { _id: { toString: () => 'u1' } };
const hashOf = (d: unknown) =>
  crypto.createHash('sha256').update(JSON.stringify(d)).digest('hex');
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
    asMock(cvService.createCVDraft).mockResolvedValue({
      draft: SAMPLE_DRAFT,
      meta: {}
    });
    const res = mockRes();
    await cvDraftController.generateCvDraft(
      mockReq({ params: { studentId: 's1' }, body: { documentsthreadId: 't1' }, user }),
      res
    );
    expect(cvService.createCVDraft).toHaveBeenCalled();
    expect(DocumentThreadService.updateThreadById).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        cv_draft: expect.objectContaining({ draft: SAMPLE_DRAFT })
      })
    );
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ draft: SAMPLE_DRAFT })
      })
    );
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

  it('snapshots the previous draft into history on regenerate', async () => {
    asMock(StudentService.getStudentByIdLean).mockResolvedValue({ _id: 's1' });
    asMock(DocumentThreadService.getThreadByIdLean).mockResolvedValue({
      additional_information: '',
      cv_draft: { draft: { personal: { fullName: 'OLD' } }, meta: {} }
    });
    asMock(cvService.createCVDraft).mockResolvedValue({
      draft: SAMPLE_DRAFT,
      meta: {}
    });
    const res = mockRes();
    await cvDraftController.generateCvDraft(
      mockReq({
        params: { studentId: 's1' },
        body: { documentsthreadId: 't1' },
        user
      }),
      res
    );
    const persisted = asMock(DocumentThreadService.updateThreadById).mock
      .calls[0][1].cv_draft;
    expect(persisted.history[0].draft).toEqual({
      personal: { fullName: 'OLD' }
    });
  });

  it('does not persist or charge quota on a parse failure', async () => {
    asMock(StudentService.getStudentByIdLean).mockResolvedValue({ _id: 's1' });
    asMock(DocumentThreadService.getThreadByIdLean).mockResolvedValue({
      additional_information: ''
    });
    asMock(cvService.createCVDraft).mockResolvedValue({
      draft: SAMPLE_DRAFT,
      meta: { parseError: 'unparseable' }
    });
    await cvDraftController.generateCvDraft(
      mockReq({
        params: { studentId: 's1' },
        body: { documentsthreadId: 't1' },
        user
      }),
      mockRes()
    );
    expect(DocumentThreadService.updateThreadById).not.toHaveBeenCalled();
    expect(PermissionService.decrementTaigerAiQuota).not.toHaveBeenCalled();
  });

  it('decrements the AI quota on a successful generation', async () => {
    asMock(StudentService.getStudentByIdLean).mockResolvedValue({ _id: 's1' });
    asMock(DocumentThreadService.getThreadByIdLean).mockResolvedValue({
      additional_information: ''
    });
    asMock(cvService.createCVDraft).mockResolvedValue({
      draft: SAMPLE_DRAFT,
      meta: {}
    });
    await cvDraftController.generateCvDraft(
      mockReq({
        params: { studentId: 's1' },
        body: { documentsthreadId: 't1' },
        user
      }),
      mockRes()
    );
    expect(PermissionService.decrementTaigerAiQuota).toHaveBeenCalled();
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
  it('renders to the stable key, persists render metadata, and does NOT post to the thread', async () => {
    asMock(StudentService.getStudentByIdLean).mockResolvedValue({
      firstname: 'Wei',
      lastname: 'Chen',
      profile: [{ name: 'Passport_Photo', path: 's1/photo.jpg' }]
    });
    asMock(DocumentThreadService.getThreadByIdLean).mockResolvedValue({
      cv_draft: {}
    });
    asMock(getS3Object).mockResolvedValue(new Uint8Array([1, 2, 3]));
    const res = mockRes();
    await cvDraftController.renderCvDraft(
      mockReq({
        params: { studentId: 's1' },
        body: { draft: SAMPLE_DRAFT, documentsthreadId: 't1' },
        user
      }),
      res
    );
    expect(renderCVDraftDocx).toHaveBeenCalled();
    expect(putS3Object).toHaveBeenCalledWith(
      expect.objectContaining({ key: 's1/t1/cv_ai_draft.docx' })
    );
    // Metadata persisted, but no message pushed to the thread.
    expect(DocumentThreadService.updateThreadById).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        cv_draft: expect.objectContaining({
          rendered: expect.objectContaining({
            key: 's1/t1/cv_ai_draft.docx',
            hash: hashOf(SAMPLE_DRAFT)
          })
        })
      })
    );
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ path: 's1/t1/cv_ai_draft.docx' })
      })
    );
  });

  it('reuses the existing render when the draft is unchanged (no re-render)', async () => {
    asMock(StudentService.getStudentByIdLean).mockResolvedValue({
      firstname: 'A',
      profile: []
    });
    asMock(DocumentThreadService.getThreadByIdLean).mockResolvedValue({
      cv_draft: {
        rendered: {
          hash: hashOf(SAMPLE_DRAFT),
          key: 's1/t1/cv_ai_draft.docx',
          name: 'A_AI_first_draft.docx',
          templateVersion: 'tpl-v1'
        }
      }
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
    expect(renderCVDraftDocx).not.toHaveBeenCalled();
    expect(putS3Object).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ reused: true })
      })
    );
  });

  it('re-renders when the stored template version no longer matches', async () => {
    asMock(StudentService.getStudentByIdLean).mockResolvedValue({
      firstname: 'A',
      profile: []
    });
    asMock(DocumentThreadService.getThreadByIdLean).mockResolvedValue({
      cv_draft: {
        rendered: {
          hash: hashOf(SAMPLE_DRAFT),
          key: 's1/t1/cv_ai_draft.docx',
          name: 'A_AI_first_draft.docx',
          templateVersion: 'OLD-TEMPLATE'
        }
      }
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
    // getCvTemplateVersion mock returns 'tpl-v1' != 'OLD-TEMPLATE' -> re-render.
    expect(renderCVDraftDocx).toHaveBeenCalled();
    expect(putS3Object).toHaveBeenCalled();
  });

  it('400s without a draft', async () => {
    await expect(
      cvDraftController.renderCvDraft(
        mockReq({ params: { studentId: 's1' }, body: { documentsthreadId: 't1' }, user }),
        mockRes()
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('attachCvDraftToThread', () => {
  it('attaches the rendered file with a versioned name that continues the thread sequence', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    // An existing manual upload at v3 — the AI draft must attach as v4, sharing
    // one continuous version sequence (matches the upload middleware).
    const messages: unknown[] = [
      { file: [{ name: 'Wang_A_CV_v3.docx', path: 's1/t1/prev.docx' }] }
    ];
    asMock(DocumentThreadService.getThreadDocById).mockResolvedValue({
      messages,
      save,
      student_id: 's1',
      file_type: 'CV',
      cv_draft: {
        rendered: {
          hash: hashOf(SAMPLE_DRAFT),
          key: 's1/t1/cv_ai_draft.docx',
          name: 'A_AI_first_draft.docx',
          templateVersion: 'tpl-v1'
        }
      }
    });
    asMock(StudentService.getStudentByIdLean).mockResolvedValue({
      firstname: 'A',
      lastname: 'Wang',
      profile: []
    });
    asMock(getS3Object).mockResolvedValue(new Uint8Array([1, 2, 3]));
    const res = mockRes();
    await cvDraftController.attachCvDraftToThread(
      mockReq({
        params: { documentsthreadId: 't1' },
        body: { draft: SAMPLE_DRAFT, message: 'Please review your CV draft.' },
        user
      }),
      res
    );
    expect(messages).toHaveLength(2);
    expect(save).toHaveBeenCalled();
    // The attached file is a message-scoped SNAPSHOT copy, not the mutable
    // stable working key (so thread history stays immutable).
    expect(putS3Object).toHaveBeenCalled();
    const attachedFile = (
      messages[1] as { file: { name: string; path: string }[] }
    ).file[0];
    expect(attachedFile.path).toMatch(/cv_ai_draft_\d+\.docx$/);
    // Student-visible name: same {lastname}_{firstname}_{fileType}_v{N} scheme as
    // manual uploads, auto-incremented (v3 -> v4), with no "AI" wording.
    expect(attachedFile.name).not.toMatch(/AI/i);
    expect(attachedFile.name).toBe('Wang_A_CV_v4.docx');
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  it('self-renders and attaches when no current working .docx exists', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const messages: unknown[] = [];
    asMock(DocumentThreadService.getThreadDocById).mockResolvedValue({
      messages,
      save,
      student_id: 's1',
      cv_draft: {}
    });
    asMock(StudentService.getStudentByIdLean).mockResolvedValue({
      firstname: 'A',
      profile: []
    });
    asMock(getS3Object).mockResolvedValue(new Uint8Array([1, 2, 3]));
    const res = mockRes();
    await cvDraftController.attachCvDraftToThread(
      mockReq({
        params: { documentsthreadId: 't1' },
        body: { draft: SAMPLE_DRAFT, message: 'hi' },
        user
      }),
      res
    );
    // Rendered on demand, then snapshot-copied and attached — no 409.
    expect(renderCVDraftDocx).toHaveBeenCalled();
    expect(messages).toHaveLength(1);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  it('409s when the thread is marked final', async () => {
    asMock(DocumentThreadService.getThreadDocById).mockResolvedValue({
      messages: [],
      save: jest.fn(),
      isFinalVersion: true,
      cv_draft: {
        rendered: {
          hash: hashOf(SAMPLE_DRAFT),
          key: 's1/t1/cv_ai_draft.docx',
          name: 'A_AI_first_draft.docx'
        }
      }
    });
    await expect(
      cvDraftController.attachCvDraftToThread(
        mockReq({
          params: { documentsthreadId: 't1' },
          body: { draft: SAMPLE_DRAFT, message: 'hi' },
          user
        }),
        mockRes()
      )
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('400s when the attach message is empty', async () => {
    asMock(DocumentThreadService.getThreadDocById).mockResolvedValue({
      messages: [],
      save: jest.fn(),
      cv_draft: {
        rendered: {
          hash: hashOf(SAMPLE_DRAFT),
          key: 's1/t1/cv_ai_draft.docx',
          name: 'A_AI_first_draft.docx'
        }
      }
    });
    await expect(
      cvDraftController.attachCvDraftToThread(
        mockReq({
          params: { documentsthreadId: 't1' },
          body: { draft: SAMPLE_DRAFT, message: '   ' },
          user
        }),
        mockRes()
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('400s without a draft', async () => {
    await expect(
      cvDraftController.attachCvDraftToThread(
        mockReq({ params: { documentsthreadId: 't1' }, body: { message: 'hi' }, user }),
        mockRes()
      )
    ).rejects.toMatchObject({ statusCode: 400 });
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
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ draft: SAMPLE_DRAFT })
      })
    );
  });

  it('trims each changelog entry to draft, source and savedAt', async () => {
    asMock(DocumentThreadService.getThreadByIdLean).mockResolvedValue({
      cv_draft: {
        draft: SAMPLE_DRAFT,
        history: [
          {
            draft: SAMPLE_DRAFT,
            meta: {
              source: 'edit',
              model: 'm',
              generatedAt: 'g',
              editedAt: 'e',
              inputsHash: 'h'
            },
            savedAt: '2026-01-01T00:00:00.000Z'
          }
        ]
      }
    });
    const res = mockRes();
    await cvDraftController.getSavedCvDraft(
      mockReq({ params: { documentsthreadId: 't1' } }),
      res
    );
    const data = asMock(res.send).mock.calls[0][0].data;
    expect(data.history).toHaveLength(1);
    expect(data.history[0]).toEqual({
      draft: SAMPLE_DRAFT,
      meta: { source: 'edit' },
      savedAt: '2026-01-01T00:00:00.000Z'
    });
  });

  it('flags inputsChanged when the saved fingerprint no longer matches', async () => {
    asMock(DocumentThreadService.getThreadByIdLean).mockResolvedValue({
      student_id: 's1',
      additional_information: 'context changed since generation',
      cv_draft: {
        draft: SAMPLE_DRAFT,
        meta: { inputsHash: 'STALE-HASH' }
      }
    });
    asMock(StudentService.getStudentByIdLean).mockResolvedValue({
      firstname: 'A',
      academic_background: {}
    });
    const res = mockRes();
    await cvDraftController.getSavedCvDraft(
      mockReq({ params: { documentsthreadId: 't1' } }),
      res
    );
    const data = asMock(res.send).mock.calls[0][0].data;
    expect(data.inputsChanged).toBe(true);
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

// A structurally-complete draft so the REAL validateCVDraft (validate.ts is not
// mocked) can run over it without throwing on missing arrays.
const FULL_DRAFT = {
  personal: {
    fullName: 'A',
    birthday: '',
    birthplace: '',
    nationality: '',
    address: '',
    phone: '',
    email: 'a@b.com'
  },
  universities: [],
  seniorHighSchools: [],
  juniorHighSchools: [],
  experience: [],
  awards: [],
  languages: [],
  computer: [],
  otherSkills: '',
  socialEngagement: '',
  competitiveSports: '',
  hobbies: '',
  anythingElse: ''
};

describe('validateCvDraft', () => {
  it('runs the deterministic checklist without persisting', async () => {
    const res = mockRes();
    await cvDraftController.validateCvDraft(
      mockReq({ params: { studentId: 's1' }, body: { draft: FULL_DRAFT } }),
      res
    );
    expect(DocumentThreadService.updateThreadById).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          validation: expect.objectContaining({
            items: expect.any(Array)
          })
        })
      })
    );
  });

  it('400s without a draft', async () => {
    await expect(
      cvDraftController.validateCvDraft(
        mockReq({ params: { studentId: 's1' }, body: {} }),
        mockRes()
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('updateCvDraft', () => {
  it('re-validates, persists the edited draft and drops the rendered file', async () => {
    asMock(DocumentThreadService.getThreadByIdLean).mockResolvedValue({
      cv_draft: {
        meta: { fileType: 'CV', model: 'm' },
        rendered: { key: 's1/t1/cv_ai_draft.docx', hash: 'h' }
      }
    });
    const res = mockRes();
    await cvDraftController.updateCvDraft(
      mockReq({
        params: { documentsthreadId: 't1' },
        body: { draft: FULL_DRAFT }
      }),
      res
    );
    expect(DocumentThreadService.updateThreadById).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        cv_draft: expect.objectContaining({
          draft: FULL_DRAFT,
          validation: expect.any(Object)
        })
      })
    );
    const persisted = asMock(DocumentThreadService.updateThreadById).mock
      .calls[0][1].cv_draft;
    expect(persisted.rendered).toBeUndefined();
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ renderedCurrent: false })
      })
    );
  });

  it("ignores a legacy source:'restore' and records the edit as 'edit'", async () => {
    asMock(DocumentThreadService.getThreadByIdLean).mockResolvedValue({
      cv_draft: { meta: { fileType: 'CV', model: 'm' } }
    });
    const res = mockRes();
    await cvDraftController.updateCvDraft(
      mockReq({
        params: { documentsthreadId: 't1' },
        body: { draft: FULL_DRAFT, source: 'restore' }
      }),
      res
    );
    const persisted = asMock(DocumentThreadService.updateThreadById).mock
      .calls[0][1].cv_draft;
    expect(persisted.meta.source).toBe('edit');
  });

  it('404s when the thread is missing', async () => {
    asMock(DocumentThreadService.getThreadByIdLean).mockResolvedValue(null);
    await expect(
      cvDraftController.updateCvDraft(
        mockReq({
          params: { documentsthreadId: 'x' },
          body: { draft: FULL_DRAFT }
        }),
        mockRes()
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('400s without a draft', async () => {
    await expect(
      cvDraftController.updateCvDraft(
        mockReq({ params: { documentsthreadId: 't1' }, body: {} }),
        mockRes()
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('getCvReadiness', () => {
  it('returns a profile readiness snapshot (no LLM, no persistence)', async () => {
    asMock(StudentService.getStudentByIdLean).mockResolvedValue({
      firstname: 'A',
      academic_background: {}
    });
    const res = mockRes();
    await cvDraftController.getCvReadiness(
      mockReq({ params: { studentId: 's1' } }),
      res
    );
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ readiness: expect.any(Array) })
      })
    );
  });

  it('404s when the student is missing', async () => {
    asMock(StudentService.getStudentByIdLean).mockResolvedValue(null);
    await expect(
      cvDraftController.getCvReadiness(
        mockReq({ params: { studentId: 'x' } }),
        mockRes()
      )
    ).rejects.toMatchObject({ statusCode: 404 });
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
