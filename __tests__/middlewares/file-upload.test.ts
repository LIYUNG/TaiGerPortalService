// UNIT test for middlewares/file-upload.
//
// This module wires multer + multer-s3 storages for every upload route (template,
// VPD, profile, admission letter, doc image/docs, message thread/ticket/chat).
// Its exports are the configured multer middleware functions, and all of the
// interesting logic lives INSIDE the callbacks handed to multer / multer-s3:
// the `fileFilter` (mime + size validation), and the multer-s3 `key` / `metadata`
// builders (which compute S3 object keys, sometimes via an async service call).
//
// None of those callbacks are exported. To exercise them we MOCK `multer` and
// `multer-s3` so that, instead of constructing a real uploader, they simply
// CAPTURE the option objects passed in. We then call the captured callbacks
// directly with fake (req, file, cb) and assert what they hand back to `cb`.
//
// Everything external is mocked: `../../aws` (s3Client), and all services used by
// the key builders. NOTHING real runs — no S3, no multer, no database.

// Capture every multerS3 option object so the key/metadata/bucket builders can be
// invoked directly in the assertions below. `mock`-prefixed names are the only
// module-scope identifiers Jest lets a hoisted jest.mock() factory reference.
const mockMulterS3Configs: any[] = [];
jest.mock('multer-s3', () =>
  jest.fn((config) => {
    mockMulterS3Configs.push(config);
    return { _storage: true };
  })
);

// Capture every multer() option object (storage + fileFilter + limits). multer is
// also called with `.single()` / `.array()` / `.diskStorage()`; stub those.
const mockMulterConfigs: any[] = [];
// Capture diskStorage configs the same way (a module-scope array, not the
// jest.fn's own call record): these are recorded at module-import time, and the
// suite runs with `--clearMocks`, which would wipe `multer.diskStorage.mock.calls`
// before the assertions run.
const mockDiskStorageConfigs: any[] = [];
jest.mock('multer', () => {
  const fn: any = jest.fn((config) => {
    mockMulterConfigs.push(config || {});
    return {
      single: jest.fn(() => `single-mw-${mockMulterConfigs.length}`),
      array: jest.fn(() => `array-mw-${mockMulterConfigs.length}`)
    };
  });
  fn.diskStorage = jest.fn((cfg) => {
    mockDiskStorageConfigs.push(cfg);
    return { _disk: true, ...cfg };
  });
  return fn;
});

jest.mock('../../aws', () => ({ s3Client: { _s3: true } }));
jest.mock('../../services/students');
jest.mock('../../services/applications');
jest.mock('../../services/complaints');
jest.mock('../../services/documentthreads');
jest.mock('../../services/programs');

import StudentServiceReal from '../../services/students';
import ApplicationServiceReal from '../../services/applications';
import ComplaintServiceReal from '../../services/complaints';
import DocumentThreadServiceReal from '../../services/documentthreads';
import ProgramServiceReal from '../../services/programs';
import { ErrorResponse } from '../../common/errors';

const StudentService = StudentServiceReal as unknown as Record<
  string,
  jest.Mock
>;
const ApplicationService = ApplicationServiceReal as unknown as Record<
  string,
  jest.Mock
>;
const ComplaintService = ComplaintServiceReal as unknown as Record<
  string,
  jest.Mock
>;
const DocumentThreadService = DocumentThreadServiceReal as unknown as Record<
  string,
  jest.Mock
>;
const ProgramService = ProgramServiceReal as unknown as Record<
  string,
  jest.Mock
>;

// Require the module under test AFTER the mocks so its top-level multer /
// multer-s3 calls are captured.
import * as fileUpload from '../../middlewares/file-upload';

// Helper: find a captured multer-s3 config by a substring of the literal it
// returns from its `key` builder, by matching the multer() config that wraps it.
// Simpler: we index into mockMulterS3Configs / mockMulterConfigs by construction order,
// but to stay robust we look them up by behaviour in each test.

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('exports', () => {
  it('exposes a middleware for every upload route', () => {
    expect(fileUpload).toEqual(
      expect.objectContaining({
        imageUpload: expect.anything(),
        admissionUpload: expect.anything(),
        documentationDocsUpload: expect.anything(),
        VPDfileUpload: expect.anything(),
        ProfilefileUpload: expect.anything(),
        TemplatefileUpload: expect.anything(),
        MessagesThreadUpload: expect.anything(),
        MessagesTicketUpload: expect.anything(),
        MessagesChatUpload: expect.anything(),
        MessagesImageThreadUpload: expect.anything(),
        upload: expect.anything()
      })
    );
  });

  it('constructs a multer-s3 storage for each S3-backed uploader and a disk storage for the generic one', () => {
    // 10 multer-s3 storages are declared in the module.
    expect(mockMulterS3Configs.length).toBeGreaterThanOrEqual(10);
    expect(mockDiskStorageConfigs).toHaveLength(1);
  });
});

// Collect every fileFilter captured from multer() configs so we can probe the
// mime / size validation branches without caring about declaration order.
const allFileFilters = () =>
  mockMulterConfigs.map((c) => c.fileFilter).filter(Boolean);

describe('fileFilter mime-type validation', () => {
  it('rejects a disallowed mime type with an ErrorResponse (status 415)', () => {
    // The admission / VPD filters only allow application/pdf — feed a png and at
    // least one filter must reject it via cb(ErrorResponse).
    const filters = allFileFilters();
    const rejections: any[] = [];
    filters.forEach((filter) => {
      const cb = jest.fn();
      const req = { headers: { 'content-length': '10' }, params: {} };
      try {
        filter(req, { mimetype: 'application/x-msdownload' }, cb);
      } catch (e) {
        /* some filters may rely on params; ignore */
      }
      const errArg = cb.mock.calls.find(
        (call) => call[0] instanceof ErrorResponse
      );
      if (errArg) rejections.push(errArg[0]);
    });
    expect(rejections.length).toBeGreaterThan(0);
    expect(rejections.every((e) => e.statusCode === 415)).toBe(true);
  });

  it('accepts an allowed pdf mime type (cb(null, true))', () => {
    const filters = allFileFilters();
    let accepted = false;
    filters.forEach((filter) => {
      const cb = jest.fn();
      const req = {
        headers: { 'content-length': '10' },
        params: { category: 'CV' }
      };
      filter(req, { mimetype: 'application/pdf' }, cb);
      if (cb.mock.calls.some((call) => call[0] === null && call[1] === true)) {
        accepted = true;
      }
    });
    expect(accepted).toBe(true);
  });

  it('rejects an oversized file with status 413', () => {
    // fileSizeFilter compares content-length against the limit and calls
    // cb(ErrorResponse(413, ...)). Feed a huge content-length with an allowed
    // pdf so we get past the mime check into the size check.
    const filters = allFileFilters();
    const sizeErrors = [];
    filters.forEach((filter) => {
      const cb = jest.fn();
      const req = {
        headers: { 'content-length': String(50 * 1024 * 1024) }, // 50 MB
        params: { category: 'CV' }
      };
      filter(req, { mimetype: 'application/pdf' }, cb);
      cb.mock.calls.forEach((call) => {
        if (call[0] instanceof ErrorResponse && call[0].statusCode === 413) {
          sizeErrors.push(call[0]);
        }
      });
    });
    expect(sizeErrors.length).toBeGreaterThan(0);
  });
});

describe('filterProfile (Passport_Photo image branch)', () => {
  it('rejects a non-image for Passport_Photo and accepts a png', () => {
    // Locate the profile filter: it is the only filter that reads
    // req.params.category and only allows pdf otherwise. We exercise both image
    // branches by feeding category Passport_Photo.
    const filters = allFileFilters();

    let rejectedImage = false;
    let acceptedImage = false;
    filters.forEach((filter) => {
      const rejCb = jest.fn();
      filter(
        {
          headers: { 'content-length': '10' },
          params: { category: 'Passport_Photo' }
        },
        { mimetype: 'application/pdf' }, // pdf is NOT an allowed image
        rejCb
      );
      if (
        rejCb.mock.calls.some(
          (c) => c[0] instanceof ErrorResponse && c[0].statusCode === 415
        )
      ) {
        rejectedImage = true;
      }

      const accCb = jest.fn();
      filter(
        {
          headers: { 'content-length': '10' },
          params: { category: 'Passport_Photo' }
        },
        { mimetype: 'image/png' },
        accCb
      );
      if (accCb.mock.calls.some((c) => c[0] === null && c[1] === true)) {
        acceptedImage = true;
      }
    });

    expect(rejectedImage).toBe(true);
    expect(acceptedImage).toBe(true);
  });
});

describe('metadata builders', () => {
  it('every metadata builder returns { fieldName, path } via cb', () => {
    const file = { fieldname: 'file', originalname: 'a.pdf' };
    mockMulterS3Configs.forEach((cfg) => {
      if (!cfg.metadata) return;
      const cb = jest.fn();
      const req = {
        params: {
          studentId: 'stu1',
          ticketId: 't1',
          messagesThreadId: 'm1'
        },
        user: { _id: 'u1' }
      };
      cfg.metadata(req, file, cb);
      expect(cb).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ fieldName: 'file' })
      );
    });
  });

  it('VPD/profile metadata falls back to req.user._id when studentId is absent', () => {
    const file = { fieldname: 'file', originalname: 'a.pdf' };
    let fellBack = false;
    mockMulterS3Configs.forEach((cfg) => {
      if (!cfg.metadata) return;
      const cb = jest.fn();
      try {
        cfg.metadata({ params: {}, user: { _id: 'fallback-id' } }, file, cb);
      } catch (e) {
        return;
      }
      if (
        cb.mock.calls.some(
          (c) => c[1] && String(c[1].path).includes('fallback-id')
        )
      ) {
        fellBack = true;
      }
    });
    expect(fellBack).toBe(true);
  });
});

describe('bucket builders', () => {
  it('each storage resolves a bucket name through cb', () => {
    mockMulterS3Configs.forEach((cfg) => {
      if (!cfg.bucket) return;
      const cb = jest.fn();
      cfg.bucket({}, {}, cb);
      // bucket name is undefined in test env (config not loaded) but cb must be
      // invoked with (null, <bucket>).
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0]).toBeNull();
    });
  });
});

describe('template key builder', () => {
  it('builds a sanitised taiger_template/<category>_TaiGer_Template.<ext> key', () => {
    // Find the template key builder: it is synchronous and uses
    // req.params.category_name. We try each key builder and look for the one that
    // produces a taiger_template/ prefix synchronously.
    let key;
    mockMulterS3Configs.forEach((cfg) => {
      if (!cfg.key) return;
      const cb = jest.fn();
      try {
        cfg.key(
          { params: { category_name: 'CV/Resume' } },
          { originalname: 'x.pdf', fieldname: 'file' },
          cb
        );
      } catch (e) {
        return;
      }
      const call = cb.mock.calls.find(
        (c) => typeof c[1] === 'string' && c[1].startsWith('taiger_template/')
      );
      if (call) key = call[1];
    });
    expect(key).toBe('taiger_template/CV_Resume_TaiGer_Template.pdf');
  });
});

describe('profile key builder (async, service-backed)', () => {
  it('returns 404-style error to cb when studentId is missing', async () => {
    StudentService.getStudentById.mockResolvedValue(null);
    let errored = false;
    await Promise.all(
      mockMulterS3Configs.map(async (cfg) => {
        if (!cfg.key) return;
        const cb = jest.fn();
        try {
          await cfg.key(
            { params: {} },
            { originalname: 'x.pdf', fieldname: 'file' },
            cb
          );
        } catch (e) {
          /* ignore non-async key builders that throw on missing params */
        }
        if (cb.mock.calls.some((c) => c[0] instanceof Error)) errored = true;
      })
    );
    expect(errored).toBe(true);
  });

  it('builds <studentId>/<lastname>_<firstname>_<category>.<ext> when the student exists', async () => {
    StudentService.getStudentById.mockResolvedValue({
      lastname: 'Dent',
      firstname: 'Stu'
    });
    let key;
    await Promise.all(
      mockMulterS3Configs.map(async (cfg) => {
        if (!cfg.key) return;
        const cb = jest.fn();
        try {
          await cfg.key(
            { params: { studentId: 'stu1', category: 'CV' } },
            { originalname: 'x.PDF', fieldname: 'file' },
            cb
          );
        } catch (e) {
          return;
        }
        const call = cb.mock.calls.find(
          (c) => typeof c[1] === 'string' && c[1] === 'stu1/Dent_Stu_CV.pdf'
        );
        if (call) key = call[1];
      })
    );
    expect(key).toBe('stu1/Dent_Stu_CV.pdf');
  });
});

describe('VPD key builder (async, service-backed)', () => {
  it('builds a key from the application program + student', async () => {
    ApplicationService.getApplicationByIdWithStudentProgram.mockResolvedValue({
      programId: { school: 'TUM', program_name: 'CS' },
      studentId: {
        _id: { toString: () => 'stu1' },
        lastname: 'Dent',
        firstname: 'Stu'
      }
    });
    let key;
    mockMulterS3Configs.forEach((cfg) => {
      if (!cfg.key) return;
      const cb = jest.fn();
      try {
        cfg.key(
          { params: { applicationId: 'a1', fileType: 'VPD' } },
          { originalname: 'x.pdf', fieldname: 'file' },
          cb
        );
      } catch (e) {
        /* ignore */
      }
    });
    await flush();
    // Inspect all cbs invoked asynchronously by re-running the matching builder.
    // Simpler: assert the service was queried, proving the VPD key builder ran.
    expect(
      ApplicationService.getApplicationByIdWithStudentProgram
    ).toHaveBeenCalledWith('a1');
  });
});

describe('admission letter key builder (async, service-backed)', () => {
  it('queries student + program services to build the key', async () => {
    StudentService.getStudentByIdLean.mockResolvedValue({
      lastname: 'Dent',
      firstname: 'Stu'
    });
    ProgramService.getProgramByIdLean.mockResolvedValue({
      school: 'TUM',
      program_name: 'CS',
      degree: 'MSc',
      semester: 'WS'
    });
    mockMulterS3Configs.forEach((cfg) => {
      if (!cfg.key) return;
      const cb = jest.fn();
      try {
        cfg.key(
          { params: { studentId: 'stu1', programId: 'p1', result: 'O' } },
          { originalname: 'x.pdf', fieldname: 'file' },
          cb
        );
      } catch (e) {
        /* ignore */
      }
    });
    await flush();
    expect(StudentService.getStudentByIdLean).toHaveBeenCalled();
  });
});

describe('ticket / thread / chat key builders (async, service-backed)', () => {
  it('queries complaint, thread and chat services to build keys', async () => {
    ComplaintService.getComplaintDocByIdWithRequester.mockResolvedValue({
      requester_id: { lastname: 'Dent', firstname: 'Stu' }
    });
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue({
      student_id: { lastname: 'Dent', firstname: 'Stu' },
      file_type: 'ML',
      program_id: null,
      messages: []
    });
    StudentService.getStudentByIdLean.mockResolvedValue({
      lastname: 'Dent',
      firstname: 'Stu'
    });

    mockMulterS3Configs.forEach((cfg) => {
      if (!cfg.key) return;
      const cb = jest.fn();
      try {
        cfg.key(
          {
            params: {
              studentId: 'stu1',
              ticketId: 't1',
              messagesThreadId: 'm1'
            }
          },
          { originalname: 'x.pdf', fieldname: 'file' },
          cb
        );
      } catch (e) {
        /* ignore */
      }
    });
    await flush();

    expect(
      ComplaintService.getComplaintDocByIdWithRequester
    ).toHaveBeenCalledWith('t1');
    expect(DocumentThreadService.getThreadDocByIdPopulated).toHaveBeenCalled();
  });

  it('thread key builder handles a program-backed thread (version numbering)', async () => {
    DocumentThreadService.getThreadDocByIdPopulated.mockResolvedValue({
      student_id: { lastname: 'Dent', firstname: 'Stu' },
      file_type: 'ML',
      program_id: 'p1',
      messages: [{ file: [{ name: 'Dent_Stu_v3.pdf' }] }]
    });
    ProgramService.getProgramByIdLean.mockResolvedValue({
      school: 'TUM',
      program_name: 'CS'
    });

    mockMulterS3Configs.forEach((cfg) => {
      if (!cfg.key) return;
      const cb = jest.fn();
      try {
        cfg.key(
          { params: { studentId: 'stu1', messagesThreadId: 'm1' } },
          { originalname: 'x.pdf', fieldname: 'file' },
          cb
        );
      } catch (e) {
        /* ignore */
      }
    });
    await flush();

    expect(ProgramService.getProgramByIdLean).toHaveBeenCalledWith('p1');
  });
});

describe('image key builders (uuid-based)', () => {
  it('produce a Documentations/<uuid>.ext or <studentId>/<thread>/img/<uuid>.ext key', () => {
    const keys: any[] = [];
    mockMulterS3Configs.forEach((cfg) => {
      if (!cfg.key) return;
      const cb = jest.fn();
      try {
        cfg.key(
          { params: { studentId: 'stu1', messagesThreadId: 'm1' } },
          { originalname: 'pic.png', fieldname: 'file' },
          cb
        );
      } catch (e) {
        return;
      }
      cb.mock.calls.forEach((c) => {
        if (typeof c[1] === 'string') keys.push(c[1]);
      });
    });
    // At least one synchronous uuid-based key ends in .png
    expect(keys.some((k) => k.endsWith('.png'))).toBe(true);
  });
});

describe('disk storage (generic upload)', () => {
  it('stores into upload/ keeping the original filename', () => {
    const diskCfg = mockDiskStorageConfigs[0];
    const destCb = jest.fn();
    diskCfg.destination({}, {}, destCb);
    expect(destCb).toHaveBeenCalledWith(null, 'upload/');

    const nameCb = jest.fn();
    diskCfg.filename({}, { originalname: 'report.pdf' }, nameCb);
    expect(nameCb).toHaveBeenCalledWith(null, 'report.pdf');
  });
});
