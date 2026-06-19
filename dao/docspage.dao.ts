import { UpdateQuery } from 'mongoose';
import { IDocspage } from '@taiger-common/model';
import { Docspage } from '../models';

/**
 * DocspageDAO — data access for the Docspage model (default-connection model
 * from models/index.js). Plain params, no req.
 */
const DocspageDAO = {
  async upsertByCategory(category: string, fields: UpdateQuery<IDocspage>) {
    return Docspage.findOneAndUpdate({ category }, fields, {
      upsert: true,
      new: true
    });
  },

  async getByCategory(category: string) {
    return Docspage.findOne({ category });
  }
};

export = DocspageDAO;
