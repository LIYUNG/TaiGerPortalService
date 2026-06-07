// DAO-level integration tests for the docs DAOs (Docspage / Documentation /
// Internaldoc) against the in-memory MongoDB.
const { connect, clearDatabase } = require('../fixtures/db');
const { Docspage, Documentation, Internaldoc } = require('../../models');
const DocspageDAO = require('../../dao/docspage.dao');
const DocumentationDAO = require('../../dao/documentation.dao');
const InternaldocDAO = require('../../dao/internaldoc.dao');
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
  await Docspage.deleteMany({});
  await Documentation.deleteMany({});
  await Internaldoc.deleteMany({});
});

describe('DocspageDAO (in-memory)', () => {
  it('upsertByCategory creates then updates a single page per category', async () => {
    await DocspageDAO.upsertByCategory('internal', { author: 'A' });
    const updated = await DocspageDAO.upsertByCategory('internal', {
      author: 'B'
    });

    expect(updated.author).toBe('B');
    expect(await Docspage.countDocuments({})).toBe(1);
  });

  it('getByCategory returns the stored page', async () => {
    await DocspageDAO.upsertByCategory('visa', { author: 'A' });
    const page = await DocspageDAO.getByCategory('visa');
    expect(page.category).toBe('visa');
  });
});

describe('DocumentationDAO (in-memory)', () => {
  it('create + findByCategory returns the doc without the text field', async () => {
    await DocumentationDAO.create({
      title: 'How to apply',
      category: 'application',
      text: 'long body'
    });

    const docs = await DocumentationDAO.findByCategory('application');

    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe('How to apply');
    expect(docs[0].text).toBeUndefined();
  });

  it('updateById and deleteById work', async () => {
    const created = await DocumentationDAO.create({
      title: 'A',
      category: 'visa'
    });
    const updated = await DocumentationDAO.updateById(created._id, {
      title: 'B'
    });
    expect(updated.title).toBe('B');

    await DocumentationDAO.deleteById(created._id);
    expect(await Documentation.countDocuments({})).toBe(0);
  });
});

describe('InternaldocDAO (in-memory)', () => {
  it('create + findAllTitleInternalCategory returns slim rows', async () => {
    await InternaldocDAO.create({
      title: 'Internal note',
      category: 'ops',
      internal: true
    });

    const docs = await InternaldocDAO.findAllTitleInternalCategory();

    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe('Internal note');
  });
});
