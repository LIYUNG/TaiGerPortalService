import { UpdateQuery } from 'mongoose';
import { IInternaldoc } from '@taiger-common/model';
import { Internaldoc } from '../models';

/**
 * InternaldocDAO — data access for the Internaldoc model (default-connection
 * model from models/index.js). Plain params, no req.
 */
const InternaldocDAO = {
  async findAllTitleInternalCategory() {
    return Internaldoc.find().select('title internal category');
  },

  async getById(docId: string) {
    return Internaldoc.findById(docId);
  },

  async create(fields: Partial<IInternaldoc>) {
    return Internaldoc.create(fields);
  },

  async updateById(docId: string, fields: UpdateQuery<IInternaldoc>) {
    return Internaldoc.findByIdAndUpdate(docId, fields, { new: true });
  },

  async deleteById(docId: string) {
    return Internaldoc.findByIdAndDelete(docId);
  }
};

export = InternaldocDAO;
