// TemplateDAO unit tests — the DAO is a thin query-building layer over the
// Mongoose Template model, so we mock the model entirely (NO database).
// These assert that each DAO method builds the expected query and forwards the
// model's result.
jest.mock('../../models', () => {
  const model = () => ({
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndDelete: jest.fn(),
    findOneAndUpdate: jest.fn()
  });
  return {
    Template: model()
  };
});

import { Template } from '../../models';
import TemplateDAO from '../../dao/template.dao';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TemplateDAO (mocked models)', () => {
  it('getTemplates finds all templates and returns the mapped result', async () => {
    Template.find.mockResolvedValue([{ _id: 't1' }]);

    const result = await TemplateDAO.getTemplates();

    expect(Template.find).toHaveBeenCalledWith({});
    expect(result).toEqual([{ _id: 't1' }]);
  });

  it('getTemplateByCategory queries by category_name and maps the doc', async () => {
    Template.findOne.mockResolvedValue({ _id: 't2', category_name: 'cv' });

    const result = await TemplateDAO.getTemplateByCategory('cv');

    expect(Template.findOne).toHaveBeenCalledWith({ category_name: 'cv' });
    expect(result).toMatchObject({ _id: 't2', category_name: 'cv' });
  });

  it('deleteTemplateByCategory uses findOneAndDelete and maps the result', async () => {
    Template.findOneAndDelete.mockResolvedValue({
      _id: 't3',
      category_name: 'cv'
    });

    const result = await TemplateDAO.deleteTemplateByCategory('cv');

    expect(Template.findOneAndDelete).toHaveBeenCalledWith({
      category_name: 'cv'
    });
    expect(result).toMatchObject({ _id: 't3', category_name: 'cv' });
  });

  it('upsertTemplate uses findOneAndUpdate with { upsert, new } and maps the doc', async () => {
    Template.findOneAndUpdate.mockResolvedValue({
      _id: 't4',
      category_name: 'rl'
    });
    const payload = { content: 'body' };

    const result = await TemplateDAO.upsertTemplate('rl', payload);

    expect(Template.findOneAndUpdate).toHaveBeenCalledWith(
      { category_name: 'rl' },
      payload,
      { upsert: true, new: true }
    );
    expect(result).toMatchObject({ _id: 't4', category_name: 'rl' });
  });
});
