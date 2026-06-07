// DAO-level integration test: exercises the real Audit queries against the
// in-memory MongoDB (this is where query/sort/pagination coverage lives now
// that controller tests mock the DAO).
const { connect, clearDatabase } = require('../fixtures/db');
const { Audit } = require('../../models');
const AuditDAO = require('../../dao/audit.dao');
const { disconnectFromDatabase } = require('../../database');
const { TENANT_ID } = require('../fixtures/constants');

beforeAll(async () => {
  await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  await Audit.deleteMany({});
});

describe('AuditDAO (in-memory)', () => {
  it('createAuditLog inserts a document', async () => {
    const created = await AuditDAO.createAuditLog({ action: 'CREATE' });
    expect(created._id).toBeDefined();
    expect(await Audit.countDocuments({})).toBe(1);
  });

  it('getAuditLogs returns matching logs filtered by action', async () => {
    await Audit.create([{ action: 'CREATE' }, { action: 'DELETE' }]);

    const logs = await AuditDAO.getAuditLogs(
      { action: 'CREATE' },
      { limit: 10, skip: 0, sort: { createdAt: -1 } }
    );

    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('CREATE');
  });

  it('applies limit / skip / sort', async () => {
    await Audit.create([{ action: 'A' }, { action: 'B' }, { action: 'C' }]);

    const page1 = await AuditDAO.getAuditLogs(
      {},
      { limit: 2, skip: 0, sort: { action: 1 } }
    );
    const page2 = await AuditDAO.getAuditLogs(
      {},
      { limit: 2, skip: 2, sort: { action: 1 } }
    );

    expect(page1.map((l) => l.action)).toEqual(['A', 'B']);
    expect(page2.map((l) => l.action)).toEqual(['C']);
  });
});
