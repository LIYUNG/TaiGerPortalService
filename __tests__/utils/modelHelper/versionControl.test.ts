// Unit tests for utils/modelHelper/versionControl.js
//
// The Program-change hook cascade. No DB: '../../models', '../../aws/s3' and the
// sibling './programChange' are mocked. The two plugins (handleProgramChanges,
// enableVersionControl) register pre/post hooks on a schema; we pass a fake
// schema that captures the registered hook fns, then invoke them with a fake
// `this` to exercise the hook bodies.

jest.mock('../../../services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

jest.mock('../../../config', () => ({
  AWS_S3_BUCKET_NAME: 'test-bucket',
  isProd: () => false,
  isInPipeline: () => false
}));

const mockListS3ObjectsV2 = jest.fn();
const mockDeleteS3Objects = jest.fn();
jest.mock('../../../aws/s3', () => ({
  listS3ObjectsV2: (...a) => mockListS3ObjectsV2(...a),
  deleteS3Objects: (...a) => mockDeleteS3Objects(...a)
}));

const mockFindStudentDelta = jest.fn();
jest.mock('../../../utils/modelHelper/programChange', () => ({
  findStudentDelta: (...a) => mockFindStudentDelta(...a)
}));

// Model mocks. Defined inside the factory (jest hoists jest.mock above all
// non-`mock`-prefixed vars), then grabbed by reference below.
jest.mock('../../../models', () => {
  const DocumentthreadCtor = jest.fn(); // constructor
  DocumentthreadCtor.findOne = jest.fn();
  DocumentthreadCtor.findByIdAndDelete = jest.fn();
  return {
    Student: { findById: jest.fn() },
    Application: { find: jest.fn(), findOneAndUpdate: jest.fn() },
    Documentthread: DocumentthreadCtor,
    surveyInput: { deleteOne: jest.fn() }
  };
});

// eslint-disable-next-line global-require
import {
  Student as StudentMock,
  Application as ApplicationMock,
  Documentthread as DocumentthreadMock,
  surveyInput as surveyInputMock
} from '../../../models';

import {
  emptyS3Directory,
  createApplicationThread,
  createApplicationThreadV2,
  deleteApplicationThread,
  handleProgramChanges,
  enableVersionControl
} from '../../../utils/modelHelper/versionControl';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('emptyS3Directory', () => {
  it('returns early when there are no objects', async () => {
    mockListS3ObjectsV2.mockResolvedValue({ Contents: [] });
    await emptyS3Directory('bucket', 'dir/');
    expect(mockDeleteS3Objects).not.toHaveBeenCalled();
  });

  it('returns early when Contents is undefined', async () => {
    mockListS3ObjectsV2.mockResolvedValue({});
    await emptyS3Directory('bucket', 'dir/');
    expect(mockDeleteS3Objects).not.toHaveBeenCalled();
  });

  it('deletes listed objects', async () => {
    mockListS3ObjectsV2.mockResolvedValue({
      Contents: [{ Key: 'a' }, { Key: 'b' }]
    });
    mockDeleteS3Objects.mockResolvedValue({});
    await emptyS3Directory('bucket', 'dir/');
    expect(mockDeleteS3Objects).toHaveBeenCalledWith({
      bucketName: 'test-bucket',
      objectKeys: [{ Key: 'a' }, { Key: 'b' }]
    });
  });
});

describe('createApplicationThread', () => {
  const studentId = 'stud-1';
  const programId = 'prog-1';

  it('throws 409 when a thread already exists', async () => {
    DocumentthreadMock.findOne.mockResolvedValue({ _id: 'existing' });
    await expect(
      createApplicationThread(studentId, programId, 'ML')
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('throws 404 when the application for the program is not found', async () => {
    DocumentthreadMock.findOne.mockResolvedValue(null);
    StudentMock.findById.mockResolvedValue({
      notification: {},
      save: jest.fn()
    });
    ApplicationMock.find.mockReturnValue({
      populate: jest
        .fn()
        .mockResolvedValue([{ programId: { _id: 'other-prog' } }])
    });
    await expect(
      createApplicationThread(studentId, programId, 'ML')
    ).rejects.toMatchObject({
      statusCode: 404,
      message: 'Application not found'
    });
  });

  it('creates a thread and saves student, application and thread', async () => {
    DocumentthreadMock.findOne.mockResolvedValue(null);
    const studentSave = jest.fn().mockResolvedValue();
    StudentMock.findById.mockResolvedValue({
      notification: { isRead_new_cvmlrl_tasks_created: true },
      save: studentSave
    });
    const newAppRecord = { id: 'rec-1' };
    const appSave = jest.fn().mockResolvedValue();
    const app = {
      _id: 'app-1',
      programId: { _id: programId },
      doc_modification_thread: {
        create: jest.fn().mockReturnValue(newAppRecord),
        push: jest.fn()
      },
      save: appSave
    };
    ApplicationMock.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([app])
    });
    // Constructor returns an object with a save fn
    const threadSave = jest.fn().mockResolvedValue();
    DocumentthreadMock.mockImplementation((data) => ({
      ...data,
      save: threadSave
    }));

    const result = await createApplicationThread(studentId, programId, 'ML');

    expect(result).toBe(newAppRecord);
    expect(app.doc_modification_thread.push).toHaveBeenCalledWith(newAppRecord);
    expect(studentSave).toHaveBeenCalled();
    expect(appSave).toHaveBeenCalled();
    expect(threadSave).toHaveBeenCalled();
  });
});

describe('createApplicationThreadV2', () => {
  const studentId = 'stud-2';
  const applicationId = 'app-2';

  it('throws 409 when a thread already exists', async () => {
    DocumentthreadMock.findOne.mockResolvedValue({ _id: 'existing' });
    await expect(
      createApplicationThreadV2(studentId, applicationId, 'SOP')
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('throws 404 when the application id is not found', async () => {
    DocumentthreadMock.findOne.mockResolvedValue(null);
    StudentMock.findById.mockResolvedValue({
      notification: {},
      save: jest.fn()
    });
    ApplicationMock.find.mockReturnValue({
      populate: jest
        .fn()
        .mockResolvedValue([{ _id: 'other-app', programId: { _id: 'p' } }])
    });
    await expect(
      createApplicationThreadV2(studentId, applicationId, 'SOP')
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('creates a thread keyed by applicationId', async () => {
    DocumentthreadMock.findOne.mockResolvedValue(null);
    StudentMock.findById.mockResolvedValue({
      notification: {},
      save: jest.fn().mockResolvedValue()
    });
    const newAppRecord = { id: 'rec-2' };
    const app = {
      _id: applicationId,
      programId: { _id: { toString: () => 'prog-2' } },
      doc_modification_thread: {
        create: jest.fn().mockReturnValue(newAppRecord),
        push: jest.fn()
      },
      save: jest.fn().mockResolvedValue()
    };
    ApplicationMock.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([app])
    });
    DocumentthreadMock.mockImplementation((data) => ({
      ...data,
      save: jest.fn().mockResolvedValue()
    }));

    const result = await createApplicationThreadV2(
      studentId,
      applicationId,
      'SOP'
    );
    expect(result).toBe(newAppRecord);
  });
});

describe('deleteApplicationThread', () => {
  it('empties S3, pulls the thread from the application, deletes thread and survey', async () => {
    mockListS3ObjectsV2.mockResolvedValue({ Contents: [] });
    ApplicationMock.findOneAndUpdate.mockResolvedValue({});
    DocumentthreadMock.findByIdAndDelete.mockResolvedValue({ file_type: 'ML' });
    surveyInputMock.deleteOne.mockResolvedValue({});

    await deleteApplicationThread(
      '507f1f77bcf86cd799439011',
      '507f1f77bcf86cd799439012',
      '507f1f77bcf86cd799439013'
    );

    expect(ApplicationMock.findOneAndUpdate).toHaveBeenCalled();
    expect(DocumentthreadMock.findByIdAndDelete).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439013'
    );
    expect(surveyInputMock.deleteOne).toHaveBeenCalledWith({
      studentId: '507f1f77bcf86cd799439011',
      programId: '507f1f77bcf86cd799439012',
      fileType: 'ML'
    });
  });
});

describe('handleProgramChanges plugin', () => {
  // capture registered hooks
  const buildSchema = () => {
    const hooks = { pre: null, post: null };
    const schema = {
      pre: jest.fn((events, fn) => {
        hooks.pre = fn;
      }),
      post: jest.fn((events, fn) => {
        hooks.post = fn;
      })
    };
    handleProgramChanges(schema);
    return hooks;
  };

  it('registers pre and post hooks for update events', () => {
    const schema = {
      pre: jest.fn(),
      post: jest.fn()
    };
    handleProgramChanges(schema);
    expect(schema.pre).toHaveBeenCalled();
    expect(schema.post).toHaveBeenCalled();
  });

  it('pre hook stores originals from this.model.find', async () => {
    const hooks = buildSchema();
    const originals = [{ _id: 'p1' }];
    const ctx = {
      getQuery: () => ({ _id: 'p1' }),
      model: {
        find: jest
          .fn()
          .mockReturnValue({ lean: () => Promise.resolve(originals) })
      }
    };
    await hooks.pre.call(ctx);
    expect(ctx._originals).toBe(originals);
  });

  it('pre hook logs and swallows errors', async () => {
    const hooks = buildSchema();
    const ctx = {
      getQuery: () => {
        throw new Error('boom');
      },
      model: { find: jest.fn() }
    };
    await expect(hooks.pre.call(ctx)).resolves.toBeUndefined();
  });

  it('post hook returns early on non-crucial changes', async () => {
    const hooks = buildSchema();
    const ctx = {
      _originals: [{ _id: 'p1', rl_required: '1' }],
      getUpdate: () => ({ $set: { someField: 'x' } })
    };
    await hooks.post.call(ctx);
    // findStudentDelta is the marker that the cascade ran; not crucial -> not run
    expect(mockFindStudentDelta).not.toHaveBeenCalled();
  });

  it('post hook returns early when there are no original docs', async () => {
    const hooks = buildSchema();
    const ctx = {
      _originals: [],
      getUpdate: () => ({ $set: { rl_required: '2' } })
    };
    await hooks.post.call(ctx);
    expect(mockFindStudentDelta).not.toHaveBeenCalled();
  });

  it('post hook runs the thread-delta cascade on crucial changes', async () => {
    const hooks = buildSchema();
    // findAffectedStudents -> Application.find().select().lean()
    ApplicationMock.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue([{ studentId: { toString: () => 's1' } }])
      })
    });
    // handleStudentDelta -> findStudentDelta returns empty delta (no add/remove)
    mockFindStudentDelta.mockResolvedValue({ add: [], remove: [] });

    const ctx = {
      _originals: [{ _id: 'p1', rl_required: '1' }],
      getUpdate: () => ({ $set: { rl_required: '2' } })
    };
    await hooks.post.call(ctx);

    expect(ApplicationMock.find).toHaveBeenCalledWith({
      programId: 'p1',
      closed: '-',
      archive: { $ne: true }
    });
    expect(mockFindStudentDelta).toHaveBeenCalled();
  });

  it('post hook cascade creates threads for delta.add and deletes empty delta.remove threads', async () => {
    const hooks = buildSchema();
    // one affected student
    ApplicationMock.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue([{ studentId: { toString: () => 's1' } }])
      })
    });

    // delta: one doc to ADD, one empty thread to REMOVE, one non-empty to SKIP
    mockFindStudentDelta.mockResolvedValue({
      add: [
        {
          studentId: { toString: () => 's1' },
          programId: { toString: () => 'p1' },
          fileType: 'ML'
        }
      ],
      remove: [
        {
          // valid 24-hex ids so deleteApplicationThread's ObjectId casts succeed
          studentId: { toString: () => '507f1f77bcf86cd799439011' },
          programId: { toString: () => '507f1f77bcf86cd799439012' },
          fileThread: {
            _id: { toString: () => '507f1f77bcf86cd799439013' },
            messageSize: 5, // non-empty -> deletion aborted
            fileType: 'SOP',
            file_type: 'SOP'
          }
        },
        {
          studentId: { toString: () => '507f1f77bcf86cd799439011' },
          programId: { toString: () => '507f1f77bcf86cd799439012' },
          fileThread: {
            _id: { toString: () => '507f1f77bcf86cd799439014' },
            messageSize: 0, // empty -> deletion proceeds
            fileType: 'PS',
            file_type: 'PS'
          }
        }
      ]
    });

    // --- createApplicationThread (delta.add) collaborators ---
    DocumentthreadMock.findOne.mockResolvedValue(null);
    StudentMock.findById.mockResolvedValue({
      notification: {},
      save: jest.fn().mockResolvedValue()
    });
    const addApp = {
      _id: 'app-1',
      programId: { _id: { toString: () => 'p1' } },
      doc_modification_thread: {
        create: jest.fn().mockReturnValue({ id: 'rec' }),
        push: jest.fn()
      },
      save: jest.fn().mockResolvedValue()
    };
    ApplicationMock.find.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue([{ studentId: { toString: () => 's1' } }])
      })
    });
    // createApplicationThread uses Application.find(...).populate(...)
    ApplicationMock.find.mockReturnValue({
      populate: jest.fn().mockResolvedValue([addApp]),
      select: jest.fn().mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue([{ studentId: { toString: () => 's1' } }])
      })
    });
    DocumentthreadMock.mockImplementation((data) => ({
      ...data,
      save: jest.fn().mockResolvedValue()
    }));

    // --- deleteApplicationThread (empty delta.remove) collaborators ---
    mockListS3ObjectsV2.mockResolvedValue({ Contents: [] });
    ApplicationMock.findOneAndUpdate.mockResolvedValue({});
    DocumentthreadMock.findByIdAndDelete.mockResolvedValue({ file_type: 'PS' });
    surveyInputMock.deleteOne.mockResolvedValue({});

    const ctx = {
      _originals: [{ _id: 'p1', rl_required: '1' }],
      getUpdate: () => ({ $set: { rl_required: '2' } })
    };
    await hooks.post.call(ctx);

    // add path created a thread
    expect(addApp.doc_modification_thread.push).toHaveBeenCalled();
    // empty-remove path deleted the thread; non-empty one was skipped
    expect(DocumentthreadMock.findByIdAndDelete).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439014'
    );
  });

  it('post hook swallows top-level errors (getUpdate throws)', async () => {
    const hooks = buildSchema();
    const ctx = {
      _originals: [{ _id: 'p1' }],
      getUpdate: () => {
        throw new Error('no update');
      }
    };
    await expect(hooks.post.call(ctx)).resolves.toBeUndefined();
  });
});

describe('enableVersionControl plugin', () => {
  const buildSchema = () => {
    const hooks = { pre: null, post: null };
    const schema = {
      pre: jest.fn((events, fn) => {
        hooks.pre = fn;
      }),
      post: jest.fn((events, fn) => {
        hooks.post = fn;
      })
    };
    enableVersionControl(schema);
    return hooks;
  };

  it('registers pre and post hooks', () => {
    const schema = { pre: jest.fn(), post: jest.fn() };
    enableVersionControl(schema);
    expect(schema.pre).toHaveBeenCalled();
    expect(schema.post).toHaveBeenCalled();
  });

  it('pre hook captures old version and changeRequestId', async () => {
    const hooks = buildSchema();
    const old = [{ _id: 'd1' }];
    const ctx = {
      model: {
        modelName: 'Program',
        find: jest.fn().mockReturnValue({ lean: () => Promise.resolve(old) })
      },
      getQuery: () => ({ _id: 'd1' }),
      getUpdate: () => ({ changeRequestId: 'cr-1' })
    };
    await hooks.pre.call(ctx);
    expect(ctx._oldVersion).toBe(old);
    expect(ctx._changeRequestId).toBe('cr-1');
  });

  it('pre hook swallows errors', async () => {
    const hooks = buildSchema();
    const ctx = {
      model: { modelName: 'Program', find: jest.fn() },
      getQuery: () => {
        throw new Error('boom');
      }
    };
    await expect(hooks.pre.call(ctx)).resolves.toBeUndefined();
  });

  it('post hook writes a VC record when there are changes', async () => {
    const hooks = buildSchema();
    const vcFindOneAndUpdate = jest.fn().mockResolvedValue({});
    const ctx = {
      model: {
        modelName: 'Program',
        db: {
          model: jest
            .fn()
            .mockReturnValue({ findOneAndUpdate: vcFindOneAndUpdate })
        }
      },
      _oldVersion: [{ _id: 'd1', ml_required: 'no' }],
      _changeRequestId: 'cr-1',
      getUpdate: () => ({ $set: { ml_required: 'yes' } })
    };
    await hooks.post.call(ctx);
    expect(vcFindOneAndUpdate).toHaveBeenCalledWith(
      { docId: 'd1', collectionName: 'Program' },
      expect.objectContaining({ $push: expect.any(Object) }),
      { upsert: true, new: true }
    );
  });

  it('post hook skips writing when there are no changes', async () => {
    const hooks = buildSchema();
    const vcFindOneAndUpdate = jest.fn();
    const ctx = {
      model: {
        modelName: 'Program',
        db: {
          model: jest
            .fn()
            .mockReturnValue({ findOneAndUpdate: vcFindOneAndUpdate })
        }
      },
      _oldVersion: [{ _id: 'd1', ml_required: 'no' }],
      _changeRequestId: 'cr-1',
      getUpdate: () => ({ $set: {} }) // no changes
    };
    await hooks.post.call(ctx);
    expect(vcFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('post hook logs and swallows VC write errors', async () => {
    const hooks = buildSchema();
    const vcFindOneAndUpdate = jest
      .fn()
      .mockRejectedValue(new Error('vc fail'));
    const ctx = {
      model: {
        modelName: 'Program',
        db: {
          model: jest
            .fn()
            .mockReturnValue({ findOneAndUpdate: vcFindOneAndUpdate })
        }
      },
      _oldVersion: [{ _id: 'd1', ml_required: 'no' }],
      _changeRequestId: 'cr-1',
      getUpdate: () => ({ $set: { ml_required: 'yes' } })
    };
    await expect(hooks.post.call(ctx)).resolves.toBeUndefined();
    expect(vcFindOneAndUpdate).toHaveBeenCalled();
  });
});

describe('exports', () => {
  it('exposes enableVersionControl as module.default too', () => {
    // eslint-disable-next-line global-require
    const mod = require('../../../utils/modelHelper/versionControl');
    expect(mod.enableVersionControl).toBe(enableVersionControl);
  });
});
