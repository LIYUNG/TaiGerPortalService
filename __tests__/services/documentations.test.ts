// DocumentationService composes three DAOs (Docspage, Documentation,
// Internaldoc). This is a UNIT test: all DAOs are mocked so no database
// (in-memory or otherwise) is touched. Every method is a thin delegator, so we
// assert each DAO method is called with the exact args and the service returns
// the DAO result.
jest.mock('../../dao/docspage.dao');
jest.mock('../../dao/documentation.dao');
jest.mock('../../dao/internaldoc.dao');

const DocspageDAO = require('../../dao/docspage.dao');
const DocumentationDAO = require('../../dao/documentation.dao');
const InternaldocDAO = require('../../dao/internaldoc.dao');
const DocumentationService = require('../../services/documentations');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DocumentationService — Docspage (mocked DAO)', () => {
  it('upsertDocspageByCategory delegates to DocspageDAO.upsertByCategory', async () => {
    const fields = { text: 'hello' };
    const daoResult = { _id: 'p1', category: 'cat1' };
    DocspageDAO.upsertByCategory.mockResolvedValue(daoResult);

    const result = await DocumentationService.upsertDocspageByCategory(
      'cat1',
      fields
    );

    expect(DocspageDAO.upsertByCategory).toHaveBeenCalledTimes(1);
    expect(DocspageDAO.upsertByCategory).toHaveBeenCalledWith('cat1', fields);
    expect(result).toBe(daoResult);
  });

  it('getDocspageByCategory delegates to DocspageDAO.getByCategory', async () => {
    const daoResult = { _id: 'p1', category: 'cat1' };
    DocspageDAO.getByCategory.mockResolvedValue(daoResult);

    const result = await DocumentationService.getDocspageByCategory('cat1');

    expect(DocspageDAO.getByCategory).toHaveBeenCalledTimes(1);
    expect(DocspageDAO.getByCategory).toHaveBeenCalledWith('cat1');
    expect(result).toBe(daoResult);
  });
});

describe('DocumentationService — Documentation (mocked DAO)', () => {
  it('getAllDocumentations delegates to DocumentationDAO.findAllTitleCategory', async () => {
    const daoResult = [{ _id: 'd1', title: 'A' }];
    DocumentationDAO.findAllTitleCategory.mockResolvedValue(daoResult);

    const result = await DocumentationService.getAllDocumentations();

    expect(DocumentationDAO.findAllTitleCategory).toHaveBeenCalledTimes(1);
    expect(DocumentationDAO.findAllTitleCategory).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });

  it('getDocumentationById delegates to DocumentationDAO.getById', async () => {
    const daoResult = { _id: 'd1' };
    DocumentationDAO.getById.mockResolvedValue(daoResult);

    const result = await DocumentationService.getDocumentationById('d1');

    expect(DocumentationDAO.getById).toHaveBeenCalledTimes(1);
    expect(DocumentationDAO.getById).toHaveBeenCalledWith('d1');
    expect(result).toBe(daoResult);
  });

  it('createDocumentation delegates to DocumentationDAO.create', async () => {
    const fields = { title: 'A', category: 'cat1' };
    const daoResult = { _id: 'd1' };
    DocumentationDAO.create.mockResolvedValue(daoResult);

    const result = await DocumentationService.createDocumentation(fields);

    expect(DocumentationDAO.create).toHaveBeenCalledTimes(1);
    expect(DocumentationDAO.create).toHaveBeenCalledWith(fields);
    expect(result).toBe(daoResult);
  });

  it('updateDocumentationById delegates to DocumentationDAO.updateById', async () => {
    const fields = { title: 'B' };
    const daoResult = { _id: 'd1', title: 'B' };
    DocumentationDAO.updateById.mockResolvedValue(daoResult);

    const result = await DocumentationService.updateDocumentationById(
      'd1',
      fields
    );

    expect(DocumentationDAO.updateById).toHaveBeenCalledTimes(1);
    expect(DocumentationDAO.updateById).toHaveBeenCalledWith('d1', fields);
    expect(result).toBe(daoResult);
  });

  it('deleteDocumentationById delegates to DocumentationDAO.deleteById', async () => {
    const daoResult = { deletedCount: 1 };
    DocumentationDAO.deleteById.mockResolvedValue(daoResult);

    const result = await DocumentationService.deleteDocumentationById('d1');

    expect(DocumentationDAO.deleteById).toHaveBeenCalledTimes(1);
    expect(DocumentationDAO.deleteById).toHaveBeenCalledWith('d1');
    expect(result).toBe(daoResult);
  });
});

describe('DocumentationService — Internaldoc (mocked DAO)', () => {
  it('getAllInternalDocumentations delegates to InternaldocDAO.findAllTitleInternalCategory', async () => {
    const daoResult = [{ _id: 'i1' }];
    InternaldocDAO.findAllTitleInternalCategory.mockResolvedValue(daoResult);

    const result = await DocumentationService.getAllInternalDocumentations();

    expect(InternaldocDAO.findAllTitleInternalCategory).toHaveBeenCalledTimes(
      1
    );
    expect(InternaldocDAO.findAllTitleInternalCategory).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });

  it('getInternalDocumentationById delegates to InternaldocDAO.getById', async () => {
    const daoResult = { _id: 'i1' };
    InternaldocDAO.getById.mockResolvedValue(daoResult);

    const result = await DocumentationService.getInternalDocumentationById(
      'i1'
    );

    expect(InternaldocDAO.getById).toHaveBeenCalledTimes(1);
    expect(InternaldocDAO.getById).toHaveBeenCalledWith('i1');
    expect(result).toBe(daoResult);
  });

  it('createInternalDocumentation delegates to InternaldocDAO.create', async () => {
    const fields = { title: 'A', internal_category: 'cat1' };
    const daoResult = { _id: 'i1' };
    InternaldocDAO.create.mockResolvedValue(daoResult);

    const result = await DocumentationService.createInternalDocumentation(
      fields
    );

    expect(InternaldocDAO.create).toHaveBeenCalledTimes(1);
    expect(InternaldocDAO.create).toHaveBeenCalledWith(fields);
    expect(result).toBe(daoResult);
  });

  it('updateInternalDocumentationById delegates to InternaldocDAO.updateById', async () => {
    const fields = { title: 'B' };
    const daoResult = { _id: 'i1', title: 'B' };
    InternaldocDAO.updateById.mockResolvedValue(daoResult);

    const result = await DocumentationService.updateInternalDocumentationById(
      'i1',
      fields
    );

    expect(InternaldocDAO.updateById).toHaveBeenCalledTimes(1);
    expect(InternaldocDAO.updateById).toHaveBeenCalledWith('i1', fields);
    expect(result).toBe(daoResult);
  });

  it('deleteInternalDocumentationById delegates to InternaldocDAO.deleteById', async () => {
    const daoResult = { deletedCount: 1 };
    InternaldocDAO.deleteById.mockResolvedValue(daoResult);

    const result = await DocumentationService.deleteInternalDocumentationById(
      'i1'
    );

    expect(InternaldocDAO.deleteById).toHaveBeenCalledTimes(1);
    expect(InternaldocDAO.deleteById).toHaveBeenCalledWith('i1');
    expect(result).toBe(daoResult);
  });
});
