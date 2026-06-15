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
  it('getTemplates finds all templates and returns the result', async () => {
    const docs = [{ _id: 't1' }];
    Template.find.mockResolvedValue(docs);

    const result = await TemplateDAO.getTemplates();

    expect(Template.find).toHaveBeenCalledWith({});
    expect(result).toBe(docs);
  });

  it('getTemplateByCategory queries by category_name and returns the doc', async () => {
    const doc = { _id: 't2', category_name: 'cv' };
    Template.findOne.mockResolvedValue(doc);

    const result = await TemplateDAO.getTemplateByCategory('cv');

    expect(Template.findOne).toHaveBeenCalledWith({ category_name: 'cv' });
    expect(result).toBe(doc);
  });

  it('deleteTemplateByCategory uses findOneAndDelete and returns the result', async () => {
    const deleted = { _id: 't3', category_name: 'cv' };
    Template.findOneAndDelete.mockResolvedValue(deleted);

    const result = await TemplateDAO.deleteTemplateByCategory('cv');

    expect(Template.findOneAndDelete).toHaveBeenCalledWith({
      category_name: 'cv'
    });
    expect(result).toBe(deleted);
  });

  it('upsertTemplate uses findOneAndUpdate with { upsert, new } and returns the doc', async () => {
    const upserted = { _id: 't4', category_name: 'rl' };
    Template.findOneAndUpdate.mockResolvedValue(upserted);
    const payload = { content: 'body' };

    const result = await TemplateDAO.upsertTemplate('rl', payload);

    expect(Template.findOneAndUpdate).toHaveBeenCalledWith(
      { category_name: 'rl' },
      payload,
      { upsert: true, new: true }
    );
    expect(result).toBe(upserted);
  });
});
