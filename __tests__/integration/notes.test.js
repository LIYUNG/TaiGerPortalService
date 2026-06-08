// Full-stack integration test for the notes routes:
//   supertest -> real router -> real controller -> real NoteService ->
//   real NoteDAO -> in-memory MongoDB.
//
// Nothing below the route is mocked (only auth/tenant middleware is stubbed).
// This is the layer that catches the seam bugs — schema mismatch, bad query,
// wrong field — that the mocked controller unit test (../controllers/notes.test.js)
// cannot see. Keep it thin: a few critical paths asserting real data, not a
// behaviour matrix (that belongs in the controller/service/dao suites).

jest.mock('../../middlewares/tenantMiddleware', () => ({
  ...jest.requireActual('../../middlewares/tenantMiddleware'),
  checkTenantDBMiddleware: jest.fn((req, res, next) => {
    req.tenantId = 'test';
    next();
  })
}));
jest.mock('../../middlewares/decryptCookieMiddleware', () => ({
  ...jest.requireActual('../../middlewares/decryptCookieMiddleware'),
  decryptCookieMiddleware: jest.fn((req, res, next) => next())
}));
jest.mock('../../middlewares/auth', () => ({
  ...jest.requireActual('../../middlewares/auth'),
  protect: jest.fn((req, res, next) => next()),
  permit: jest.fn(() => (req, res, next) => next())
}));
jest.mock('../../middlewares/limit_archiv_user', () => ({
  ...jest.requireActual('../../middlewares/limit_archiv_user'),
  filter_archiv_user: jest.fn((req, res, next) => next())
}));

const request = require('supertest');
const { connect, clearDatabase } = require('../fixtures/db');
const { app } = require('../../app');
const { UserSchema } = require('../../models/User');
const { notesSchema } = require('../../models/Note');
const { protect } = require('../../middlewares/auth');
const { TENANT_ID } = require('../fixtures/constants');
const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
const { users, admin, student } = require('../mock/user');
const { generateNote } = require('../mock/notes');
const { disconnectFromDatabase } = require('../../database');

const api = request(app);
const studentId = student._id.toString();
let dbUri;

beforeAll(async () => {
  dbUri = await connect();
});
afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});
beforeEach(async () => {
  const db = connectToDatabase(TENANT_ID, dbUri);
  const UserModel = db.model('User', UserSchema);
  const NoteModel = db.model('Note', notesSchema);
  await UserModel.deleteMany();
  await NoteModel.deleteMany();
  await UserModel.insertMany(users);
  await NoteModel.insertMany([generateNote(studentId)]);
  protect.mockImplementation((req, res, next) => {
    req.user = admin;
    next();
  });
});

describe('GET /api/notes/:student_id (full stack)', () => {
  it('returns the persisted note for the student', async () => {
    const resp = await api
      .get(`/api/notes/${studentId}`)
      .set('tenantId', TENANT_ID);

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(resp.body.data.student_id.toString()).toBe(studentId);
  });
});

describe('PUT /api/notes/:student_id (full stack)', () => {
  it('upserts the note and the change is visible on a subsequent read', async () => {
    const notes = 'Updated note content';

    const put = await api
      .put(`/api/notes/${studentId}`)
      .set('tenantId', TENANT_ID)
      .send({ notes });

    expect(put.status).toBe(200);
    expect(put.body.success).toBe(true);

    const get = await api
      .get(`/api/notes/${studentId}`)
      .set('tenantId', TENANT_ID);

    expect(get.status).toBe(200);
    expect(get.body.data.notes).toBe(notes);
  });
});
