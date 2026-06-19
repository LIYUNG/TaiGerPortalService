import { IBasedocumentationslink } from '@taiger-common/model';
import BasedocumentationslinkDAO from '../dao/basedocumentationslink.dao';

/**
 * BasedocumentationslinkService — business layer for the base-documents / survey
 * helper links. Delegates data access to the DAO (controller -> service -> dao).
 */
const BasedocumentationslinkService = {
  findByCategory(category: string) {
    return BasedocumentationslinkDAO.findByCategory(category);
  },

  upsertByCategoryKey(
    category: string,
    key: string,
    set: Partial<IBasedocumentationslink>
  ) {
    return BasedocumentationslinkDAO.upsertByCategoryKey(category, key, set);
  }
};

export = BasedocumentationslinkService;
