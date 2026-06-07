const mongoose = require('mongoose');
const { connect, clearDatabase } = require('../fixtures/db');
const { Communication } = require('../../models');
const CommunicationDAO = require('../../dao/communication.dao');
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
  await Communication.deleteMany({});
});

describe('CommunicationDAO (in-memory)', () => {
  it('getCommunications returns docs matching the query', async () => {
    const studentA = new mongoose.Types.ObjectId();
    await Communication.create([
      { student_id: studentA, message: 'a' },
      { student_id: studentA, message: 'b' },
      { student_id: new mongoose.Types.ObjectId(), message: 'c' }
    ]);

    const res = await CommunicationDAO.getCommunications({
      student_id: studentA
    });

    expect(res).toHaveLength(2);
  });

  it('getCommunicationById returns the document', async () => {
    const created = await Communication.create({ message: 'hello' });

    const found = await CommunicationDAO.getCommunicationById(created._id);

    expect(found._id.toString()).toBe(created._id.toString());
    expect(found.message).toBe('hello');
  });

  it('updateCommunication applies the update and returns the new doc', async () => {
    const created = await Communication.create({ message: 'before' });

    const updated = await CommunicationDAO.updateCommunication(created._id, {
      message: 'after'
    });

    expect(updated.message).toBe('after');
  });
});
