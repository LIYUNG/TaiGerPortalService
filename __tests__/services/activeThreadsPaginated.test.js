// Service-level integration test for the active-document-thread aggregation
// (DocumentThreadService.getActiveThreadsPaginated / getActiveThreadsCounts),
// run against the in-memory MongoDB through the DEFAULT connection.
//
// This deliberately exercises the service (not the HTTP controller): the
// controller is a thin wrapper that resolves the active student ids and forwards
// them, so seeding and reading both happen on the SAME (default) connection.
// That removes the per-request-connection split that made the old HTTP test
// flaky, and keeps the controller test layer DB-free.
const mongoose = require('mongoose');

const { connect, clearDatabase } = require('../fixtures/db');
const { User, Program, Application, Documentthread } = require('../../models');
const { disconnectFromDatabase } = require('../../database');
const { TENANT_ID } = require('../fixtures/constants');
const { users, admin, agent, student } = require('../mock/user');
const DocumentThreadService = require('../../services/documentthreads');

const byFileType = (threads, ft) => threads.find((t) => t.file_type === ft);

// The "all students" views pass every active student id; here that is the seeded
// student who owns both threads.
const ALL_STUDENT_IDS = () => [student._id.toString()];

const list = (query = {}, opts = {}) =>
  DocumentThreadService.getActiveThreadsPaginated({
    studentIds: ALL_STUDENT_IDS(),
    query,
    ...opts
  });
const counts = (query = {}, opts = {}) =>
  DocumentThreadService.getActiveThreadsCounts({
    studentIds: ALL_STUDENT_IDS(),
    query,
    ...opts
  });

beforeAll(async () => {
  await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany(),
    Program.deleteMany(),
    Application.deleteMany(),
    Documentthread.deleteMany()
  ]);

  await User.insertMany(users);

  const [program] = await Program.insertMany([
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

  const [application] = await Application.insertMany([
    {
      studentId: student._id,
      programId: program._id,
      decided: 'O',
      closed: '-',
      application_year: '2025',
      isLocked: false
    }
  ]);

  await Documentthread.insertMany([
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

describe('DocumentThreadService.getActiveThreadsPaginated (in-memory)', () => {
  it('returns slim paginated rows with DB-computed fields', async () => {
    const { threads, total } = await list();

    expect(total).toBe(2);

    const ml = byFileType(threads, 'ML');
    const cv = byFileType(threads, 'CV');

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
    const { threads, total } = await list({ document_name: 'Aalto' });
    expect(total).toBe(1);
    expect(threads[0].file_type).toBe('ML');
  });

  it('filters by deadline (year/month text match)', async () => {
    // ML thread's derived deadline is "2025/01/15".
    const match = await list({ deadline: '2025/01' });
    expect(match.total).toBe(1);
    expect(match.threads[0].file_type).toBe('ML');

    // A different month matches nothing.
    const noMatch = await list({ deadline: '2025/02' });
    expect(noMatch.total).toBe(0);
  });

  it('filters by the tab category (in_progress vs no_input)', async () => {
    const inProgress = await list({ category: 'in_progress' });
    const noInput = await list({ category: 'no_input' });

    expect(inProgress.total).toBe(1);
    expect(inProgress.threads[0].file_type).toBe('ML');
    expect(noInput.total).toBe(1);
    expect(noInput.threads[0].file_type).toBe('CV');
  });

  it('sorts by document_name', async () => {
    const { threads } = await list({
      sortBy: 'document_name',
      sortOrder: 'asc'
    });

    // "CV" < "ML - ..." lexicographically
    expect(threads.map((t) => t.file_type)).toEqual(['CV', 'ML']);
  });

  it('returns per-tab counts', async () => {
    const data = await counts();

    // ML has messages -> in_progress; CV has none -> no_input.
    expect(data).toMatchObject({
      all: 2,
      closed: 0,
      in_progress: 1,
      no_input: 1
    });
  });

  it('filters by the favorites category (flag_by_user_id)', async () => {
    // agent flags the ML (non-final) thread.
    await Documentthread.updateOne(
      { file_type: 'ML' },
      { $set: { flag_by_user_id: [agent._id] } }
    );

    const listResult = await list({
      category: 'fav',
      viewerId: agent._id.toString()
    });
    const countResult = await counts({ viewerId: agent._id.toString() });

    expect(listResult.total).toBe(1);
    expect(listResult.threads[0].file_type).toBe('ML');
    expect(listResult.threads[0].flag_by_user_id).toContain(
      agent._id.toString()
    );
    expect(countResult.fav).toBe(1);
  });

  it('filters by viewer-dependent category (new_message)', async () => {
    // Latest ML message is by `agent`; for viewer=student that is "new".
    const { threads, total } = await list({
      category: 'new_message',
      viewerId: student._id.toString()
    });

    expect(total).toBe(1);
    expect(threads[0].file_type).toBe('ML');
    // Essay-only fields are present on the slim row.
    expect(Array.isArray(threads[0].agents)).toBe(true);
    expect(Array.isArray(threads[0].flag_by_user_id)).toBe(true);
  });

  it('splits follow-up (last msg by viewer) from no-action (no messages)', async () => {
    // ML's last message is by `agent`; CV has no messages at all.
    const followup = await list({
      category: 'followup',
      viewerId: agent._id.toString()
    });
    expect(followup.total).toBe(1);
    expect(followup.threads[0].file_type).toBe('ML');

    const noAction = await list({
      category: 'pending_progress',
      viewerId: agent._id.toString()
    });
    expect(noAction.total).toBe(1);
    expect(noAction.threads[0].file_type).toBe('CV');

    const countResult = await counts({ viewerId: agent._id.toString() });
    expect(countResult.followup).toBe(1);
    expect(countResult.pending_progress).toBe(1);
  });

  it('scopes my-students threads to the supervising user', async () => {
    // `agent` supervises `student` (who owns both threads).
    await User.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(student._id) },
      { $set: { agents: [new mongoose.Types.ObjectId(agent._id)] } }
    );

    // The "my students" view passes the supervised student ids + the viewer.
    const mine = await DocumentThreadService.getActiveThreadsPaginated({
      studentIds: [student._id.toString()],
      outsourcedUserId: agent._id.toString(),
      query: { viewerId: agent._id.toString() }
    });
    const mineCounts = await DocumentThreadService.getActiveThreadsCounts({
      studentIds: [student._id.toString()],
      outsourcedUserId: agent._id.toString(),
      query: { viewerId: agent._id.toString() }
    });
    // A user who supervises nobody (and isn't an essay writer) sees nothing.
    const other = await DocumentThreadService.getActiveThreadsPaginated({
      studentIds: [],
      outsourcedUserId: admin._id.toString(),
      query: { viewerId: admin._id.toString() }
    });

    expect(mine.total).toBe(2);
    expect(mineCounts.all).toBe(2);
    expect(other.total).toBe(0);
  });

  it('excludes file types unless the viewer is outsourced on the thread', async () => {
    // A support-doc thread for the same (supervised) student, no outsourcing.
    await Documentthread.insertMany([
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
    const all = await list();
    expect(all.total).toBe(3);

    // Excluded type + viewer not outsourced -> the support doc is hidden.
    const excludedQuery = {
      excludeFileType: 'Supplementary_Form',
      viewerId: agent._id.toString()
    };
    const excluded = await list(excludedQuery);
    expect(excluded.total).toBe(2);
    expect(byFileType(excluded.threads, 'Supplementary_Form')).toBeUndefined();

    const excludedCounts = await counts(excludedQuery);
    expect(excludedCounts.all).toBe(2);

    // Outsourced to the viewer -> visible again despite the exclusion.
    await Documentthread.updateOne(
      { file_type: 'Supplementary_Form' },
      { $set: { outsourced_user_id: [agent._id] } }
    );
    const visible = await list(excludedQuery);
    expect(visible.total).toBe(3);
    expect(byFileType(visible.threads, 'Supplementary_Form')).toBeDefined();
  });

  it('combines fileType + excludeFileType (agent-support semantics)', async () => {
    // An Essay thread (not outsourced) and a support-doc thread.
    await Documentthread.insertMany([
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
    const query = {
      file_type: 'Essay,Supplementary_Form',
      excludeFileType: 'Essay',
      viewerId: agent._id.toString()
    };
    const supportOnly = await list(query);
    // Support doc shown; non-outsourced essay hidden.
    expect(supportOnly.total).toBe(1);
    expect(byFileType(supportOnly.threads, 'Supplementary_Form')).toBeDefined();
    expect(byFileType(supportOnly.threads, 'Essay')).toBeUndefined();

    // Outsource the essay to the viewer -> it appears alongside the support doc.
    await Documentthread.updateOne(
      { file_type: 'Essay' },
      { $set: { outsourced_user_id: [agent._id] } }
    );
    const withEssay = await list(query);
    expect(withEssay.total).toBe(2);
    expect(byFileType(withEssay.threads, 'Essay')).toBeDefined();
  });
});
