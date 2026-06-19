import { UpdateQuery } from 'mongoose';
import { IDocumentation } from '@taiger-common/model';
import { Documentation } from '../models';

/**
 * DocumentationDAO — data access for the Documentation model
 * (default-connection model from models/index.js). Plain params, no req.
 */
const DocumentationDAO = {
  async findAllTitleCategory() {
    return Documentation.find().select('title category');
  },

  async getById(docId: string) {
    return Documentation.findById(docId);
  },

  async create(fields: Partial<IDocumentation>) {
    return Documentation.create(fields);
  },

  async updateById(docId: string, fields: UpdateQuery<IDocumentation>) {
    return Documentation.findByIdAndUpdate(docId, fields, { new: true });
  },

  async deleteById(docId: string) {
    return Documentation.findByIdAndDelete(docId);
  }
};

export = DocumentationDAO;
