import { IBasedocumentationslink } from '@taiger-common/model';
import { Basedocumentationslink } from '../models';

/**
 * BasedocumentationslinkDAO — data access for the Basedocumentationslink model
 * (default-connection model from models/index.js). Plain params, no req.
 */
const BasedocumentationslinkDAO = {
  async findByCategory(category: string) {
    return Basedocumentationslink.find({ category });
  },

  async upsertByCategoryKey(
    category: string,
    key: string,
    set: Partial<IBasedocumentationslink>
  ) {
    return Basedocumentationslink.findOneAndUpdate(
      { category, key },
      { $set: set },
      { upsert: true }
    );
  }
};

export = BasedocumentationslinkDAO;
