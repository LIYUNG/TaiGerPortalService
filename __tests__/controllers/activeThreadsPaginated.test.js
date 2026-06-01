const request = require('supertest');
const mongoose = require('mongoose');

const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { UserSchema } = require('../../models/User');
const { programSchema } = require('../../models/Program');
const { documentThreadsSchema } = require('../../models/Documentthread');
const { protect } = require('../../middlewares/auth');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { TENANT_ID } = require('../fixtures/constants');
const { users, admin, agent, student } = require('../mock/user');
const { disconnectFromDatabase } = require('../../database');

const requestWithSupertest = request(app);

jest.mock('../../middlewares/tenantMiddleware', () => {
  const passthrough = async (req, res, next) => {
    req.tenantId = 'test';
    next();
  };
  return {
    ...jest.requireActual('../../middlewares/tenantMiddleware'),
    checkTenantDBMiddleware: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/decryptCookieMiddleware', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/decryptCookieMiddleware'),
    decryptCookieMiddleware: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation(() => passthrough)
  };
});

let dbUri;
const PAGINATED_URL = '/api/document-threads/overview/all/paginated';

beforeAll(async () => {
  dbUri = await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  protect.mockImplementation(async (req, res, next) => {
    req.user = admin;
    next();
  });

  const db = connectToDatabase(TENANT_ID, dbUri);
  const UserModel = db.model('User', UserSchema);
  const ProgramModel = db.model('Program', programSchema);
  const ApplicationModel = db.model('Application');
  const ThreadModel = db.model('Documentthread', documentThreadsSchema);

  await Promise.all([
    UserModel.deleteMany(),
    ProgramModel.deleteMany(),
    ApplicationModel.deleteMany(),
    ThreadModel.deleteMany()
  ]);

  await UserModel.insertMany(users);

  const [program] = await ProgramModel.insertMany([
    {
      school: 'Aalto University',
      program_name: 'Alpha',
      degree: 'MS',
      semester: 'WS',
      lang: 'English',
      country: 'de', // approval country
      application_deadline: '01-15',
      updatedAt: new Date() // recent -> not stale
    }
  ]);

  const [application] = await ApplicationModel.insertMany([
    {
      studentId: student._id,
      programId: program._id,
      decided: 'O',
      closed: '-',
      application_year: '2025',
      isLocked: false
    }
  ]);

  await ThreadModel.insertMany([
    {
      // application thread, has messages, not final -> "in_progress"
      student_id: student._id,
      application_id: application._id,
      program_id: program._id,
      file_type: 'ML',
      isFinalVersion: false,
      messages: [
        { user_id: student._id, file: [{ name: 'a', path: 'p' }] },
        { user_id: agent._id, file: [] }
      ],
      updatedAt: new Date()
    },
    {
      // general thread, no messages, not final -> "no_input"
      student_id: student._id,
      application_id: null,
      program_id: null,
      file_type: 'CV',
      isFinalVersion: false,
      messages: [],
      updatedAt: new Date()
    }
  ]);
});

const byFileType = (resp, ft) =>
  resp.body.data.threads.find((t) => t.file_type === ft);

describe('GET /api/document-threads/overview/all/paginated', () => {
  it('returns slim paginated rows with DB-computed fields', async () => {
    const resp = await requestWithSupertest
      .get(PAGINATED_URL)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.data.total).toBe(2);

    const ml = byFileType(resp, 'ML');
    const cv = byFileType(resp, 'CV');

    // document_name composition
    expect(ml.document_name).toBe('ML - Aalto University - MS -Alpha');
    expect(cv.document_name).toBe('CV');

    // derived deadline (application_year 2025, WS, 01-15 -> 2025/01/15)
    expect(ml.deadline).toBe('2025/01/15');
    expect(cv.deadline).toBe('-');

    // message-derived counts ("msgs/files")
    expect(ml.number_input_from_student).toBe('1/1');
    expect(ml.number_input_from_editors).toBe('1/0');

    // latest message left by the editor (last message)
    expect(ml.latest_message_left_by_id).toBe(agent._id.toString());
    expect(cv.latest_message_left_by_id).toBe('- None - ');

    // approval country + recent program -> unlocked; no rows leak messages.
    expect(ml.isApplicationLocked).toBe(false);
    expect(ml).not.toHaveProperty('messages');
  });

  it('filters by document_name (contains)', async () => {
    const resp = await requestWithSupertest
      .get(`${PAGINATED_URL}?document_name=Aalto`)
      .set('tenantId', TENANT_ID);

    expect(resp.body.data.total).toBe(1);
    expect(resp.body.data.threads[0].file_type).toBe('ML');
  });

  it('filters by the tab category (in_progress vs no_input)', async () => {
    const inProgress = await requestWithSupertest
      .get(`${PAGINATED_URL}?category=in_progress`)
      .set('tenantId', TENANT_ID);
    const noInput = await requestWithSupertest
      .get(`${PAGINATED_URL}?category=no_input`)
      .set('tenantId', TENANT_ID);

    expect(inProgress.body.data.total).toBe(1);
    expect(inProgress.body.data.threads[0].file_type).toBe('ML');
    expect(noInput.body.data.total).toBe(1);
    expect(noInput.body.data.threads[0].file_type).toBe('CV');
  });

  it('sorts by document_name', async () => {
    const resp = await requestWithSupertest
      .get(`${PAGINATED_URL}?sortBy=document_name&sortOrder=asc`)
      .set('tenantId', TENANT_ID);

    // "CV" < "ML - ..." lexicographically
    expect(resp.body.data.threads.map((t) => t.file_type)).toEqual([
      'CV',
      'ML'
    ]);
  });

  it('returns per-tab counts', async () => {
    const resp = await requestWithSupertest
      .get('/api/document-threads/overview/all/counts')
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    // ML has messages -> in_progress; CV has none -> no_input.
    expect(resp.body.data).toMatchObject({
      all: 2,
      closed: 0,
      in_progress: 1,
      no_input: 1
    });
  });

  it('filters by the favorites category (flag_by_user_id)', async () => {
    const db = connectToDatabase(TENANT_ID, dbUri);
    const ThreadModel = db.model('Documentthread', documentThreadsSchema);
    // agent flags the ML (non-final) thread.
    await ThreadModel.updateOne(
      { file_type: 'ML' },
      { $set: { flag_by_user_id: [agent._id] } }
    );

    const list = await requestWithSupertest
      .get(`${PAGINATED_URL}?category=fav&viewerId=${agent._id}`)
      .set('tenantId', TENANT_ID);
    const counts = await requestWithSupertest
      .get(`/api/document-threads/overview/all/counts?viewerId=${agent._id}`)
      .set('tenantId', TENANT_ID);

    expect(list.body.data.total).toBe(1);
    expect(list.body.data.threads[0].file_type).toBe('ML');
    expect(list.body.data.threads[0].flag_by_user_id).toContain(
      agent._id.toString()
    );
    expect(counts.body.data.fav).toBe(1);
  });

  it('filters by viewer-dependent category (new_message)', async () => {
    // Latest ML message is by `agent`; for viewer=student that is "new".
    const resp = await requestWithSupertest
      .get(`${PAGINATED_URL}?category=new_message&viewerId=${student._id}`)
      .set('tenantId', TENANT_ID);

    expect(resp.body.data.total).toBe(1);
    expect(resp.body.data.threads[0].file_type).toBe('ML');
    // Essay-only fields are present on the slim row.
    expect(Array.isArray(resp.body.data.threads[0].agents)).toBe(true);
    expect(Array.isArray(resp.body.data.threads[0].flag_by_user_id)).toBe(true);
  });

  it('splits follow-up (last msg by viewer) from no-action (no messages)', async () => {
    // ML's last message is by `agent`; CV has no messages at all.
    const followup = await requestWithSupertest
      .get(`${PAGINATED_URL}?category=followup&viewerId=${agent._id}`)
      .set('tenantId', TENANT_ID);
    expect(followup.body.data.total).toBe(1);
    expect(followup.body.data.threads[0].file_type).toBe('ML');

    const noAction = await requestWithSupertest
      .get(`${PAGINATED_URL}?category=pending_progress&viewerId=${agent._id}`)
      .set('tenantId', TENANT_ID);
    expect(noAction.body.data.total).toBe(1);
    expect(noAction.body.data.threads[0].file_type).toBe('CV');

    const counts = await requestWithSupertest
      .get(`/api/document-threads/overview/all/counts?viewerId=${agent._id}`)
      .set('tenantId', TENANT_ID);
    expect(counts.body.data.followup).toBe(1);
    expect(counts.body.data.pending_progress).toBe(1);
  });

  it('scopes my-students threads to the supervising user', async () => {
    const db = connectToDatabase(TENANT_ID, dbUri);
    const UserModel = db.model('User', UserSchema);
    // `agent` supervises `student` (who owns both threads).
    await UserModel.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(student._id) },
      { $set: { agents: [new mongoose.Types.ObjectId(agent._id)] } }
    );

    const mine = await requestWithSupertest
      .get(`/api/document-threads/overview/taiger-user/${agent._id}/paginated`)
      .set('tenantId', TENANT_ID);
    const counts = await requestWithSupertest
      .get(`/api/document-threads/overview/taiger-user/${agent._id}/counts`)
      .set('tenantId', TENANT_ID);
    // A user who supervises nobody (and isn't an essay writer) sees nothing.
    const other = await requestWithSupertest
      .get(`/api/document-threads/overview/taiger-user/${admin._id}/paginated`)
      .set('tenantId', TENANT_ID);

    expect(mine.status).toBe(200);
    expect(mine.body.data.total).toBe(2);
    expect(counts.body.data.all).toBe(2);
    expect(other.body.data.total).toBe(0);
  });

  it('excludes file types unless the viewer is outsourced on the thread', async () => {
    const db = connectToDatabase(TENANT_ID, dbUri);
    const ThreadModel = db.model('Documentthread', documentThreadsSchema);
    // A support-doc thread for the same (supervised) student, no outsourcing.
    await ThreadModel.insertMany([
      {
        student_id: student._id,
        application_id: null,
        program_id: null,
        file_type: 'Supplementary_Form',
        isFinalVersion: false,
        messages: [],
        updatedAt: new Date()
      }
    ]);

    // No exclusion -> all three threads show.
    const all = await requestWithSupertest
      .get(PAGINATED_URL)
      .set('tenantId', TENANT_ID);
    expect(all.body.data.total).toBe(3);

    // Excluded type + viewer not outsourced -> the support doc is hidden.
    const excludedUrl = `${PAGINATED_URL}?excludeFileType=Supplementary_Form&viewerId=${agent._id}`;
    const excluded = await requestWithSupertest
      .get(excludedUrl)
      .set('tenantId', TENANT_ID);
    expect(excluded.body.data.total).toBe(2);
    expect(byFileType(excluded, 'Supplementary_Form')).toBeUndefined();

    const excludedCounts = await requestWithSupertest
      .get(
        `/api/document-threads/overview/all/counts?excludeFileType=Supplementary_Form&viewerId=${agent._id}`
      )
      .set('tenantId', TENANT_ID);
    expect(excludedCounts.body.data.all).toBe(2);

    // Outsourced to the viewer -> visible again despite the exclusion.
    await ThreadModel.updateOne(
      { file_type: 'Supplementary_Form' },
      { $set: { outsourced_user_id: [agent._id] } }
    );
    const visible = await requestWithSupertest
      .get(excludedUrl)
      .set('tenantId', TENANT_ID);
    expect(visible.body.data.total).toBe(3);
    expect(byFileType(visible, 'Supplementary_Form')).toBeDefined();
  });

  it('combines fileType + excludeFileType (agent-support semantics)', async () => {
    const db = connectToDatabase(TENANT_ID, dbUri);
    const ThreadModel = db.model('Documentthread', documentThreadsSchema);
    // An Essay thread (not outsourced) and a support-doc thread.
    await ThreadModel.insertMany([
      {
        student_id: student._id,
        file_type: 'Essay',
        isFinalVersion: false,
        messages: [],
        updatedAt: new Date()
      },
      {
        student_id: student._id,
        file_type: 'Supplementary_Form',
        isFinalVersion: false,
        messages: [],
        updatedAt: new Date()
      }
    ]);

    // Restrict to {Essay, Supplementary_Form}, but Essay only if outsourced.
    const url = `${PAGINATED_URL}?file_type=Essay,Supplementary_Form&excludeFileType=Essay&viewerId=${agent._id}`;
    const supportOnly = await requestWithSupertest
      .get(url)
      .set('tenantId', TENANT_ID);
    // Support doc shown; non-outsourced essay hidden.
    expect(supportOnly.body.data.total).toBe(1);
    expect(byFileType(supportOnly, 'Supplementary_Form')).toBeDefined();
    expect(byFileType(supportOnly, 'Essay')).toBeUndefined();

    // Outsource the essay to the viewer -> it appears alongside the support doc.
    await ThreadModel.updateOne(
      { file_type: 'Essay' },
      { $set: { outsourced_user_id: [agent._id] } }
    );
    const withEssay = await requestWithSupertest
      .get(url)
      .set('tenantId', TENANT_ID);
    expect(withEssay.body.data.total).toBe(2);
    expect(byFileType(withEssay, 'Essay')).toBeDefined();
  });
});
