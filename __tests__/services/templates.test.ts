// TemplateService is a thin pass-through to TemplateDAO (controller -> service
// -> dao). This is a UNIT test: the DAO is mocked so no database (in-memory or
// otherwise) is touched. Each test asserts the service delegates to the right
// DAO method with the exact args and returns the DAO's result.
jest.mock('../../dao/template.dao');

import TemplateDAO from '../../dao/template.dao';
import TemplateService from '../../services/templates';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TemplateService (mocked DAO)', () => {
  it('getTemplates delegates to DAO.getTemplates and returns its result', async () => {
    const daoResult = [{ _id: 't1' }, { _id: 't2' }];
    TemplateDAO.getTemplates.mockResolvedValue(daoResult);

    const result = await TemplateService.getTemplates();

    expect(TemplateDAO.getTemplates).toHaveBeenCalledTimes(1);
    expect(TemplateDAO.getTemplates).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });

  it('getTemplateByCategory delegates with categoryName and returns its result', async () => {
    const daoResult = { _id: 't1', category_name: 'CV' };
    TemplateDAO.getTemplateByCategory.mockResolvedValue(daoResult);

    const result = await TemplateService.getTemplateByCategory('CV');

    expect(TemplateDAO.getTemplateByCategory).toHaveBeenCalledTimes(1);
    expect(TemplateDAO.getTemplateByCategory).toHaveBeenCalledWith('CV');
    expect(result).toBe(daoResult);
  });

  it('deleteTemplateByCategory delegates with categoryName and returns its result', async () => {
    const daoResult = { deletedCount: 1 };
    TemplateDAO.deleteTemplateByCategory.mockResolvedValue(daoResult);

    const result = await TemplateService.deleteTemplateByCategory('CV');

    expect(TemplateDAO.deleteTemplateByCategory).toHaveBeenCalledTimes(1);
    expect(TemplateDAO.deleteTemplateByCategory).toHaveBeenCalledWith('CV');
    expect(result).toBe(daoResult);
  });

  it('upsertTemplate delegates with categoryName + payload and returns its result', async () => {
    const payload = { fileType: 'pdf', path: '/tmp/cv.pdf' };
    const daoResult = { _id: 't1', category_name: 'CV', ...payload };
    TemplateDAO.upsertTemplate.mockResolvedValue(daoResult);

    const result = await TemplateService.upsertTemplate('CV', payload);

    expect(TemplateDAO.upsertTemplate).toHaveBeenCalledTimes(1);
    expect(TemplateDAO.upsertTemplate).toHaveBeenCalledWith('CV', payload);
    expect(result).toBe(daoResult);
  });
});
