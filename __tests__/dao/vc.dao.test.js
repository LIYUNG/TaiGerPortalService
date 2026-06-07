const mongoose = require('mongoose');
const { connect, clearDatabase } = require('../fixtures/db');
const { VC } = require('../../models');
const VCDAO = require('../../dao/vc.dao');
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
  await VC.deleteMany({});
});

describe('VCDAO (in-memory)', () => {
  it('getVC returns the matching version-control doc', async () => {
    const docId = new mongoose.Types.ObjectId();
    await VC.create({ docId, collectionName: 'Program', changes: [] });

    const vc = await VCDAO.getVC({ docId });

    expect(vc).toBeTruthy();
    expect(vc.collectionName).toBe('Program');
  });

  it('getVC returns null when no match', async () => {
    const vc = await VCDAO.getVC({
      docId: new mongoose.Types.ObjectId()
    });

    expect(vc).toBeNull();
  });
});
