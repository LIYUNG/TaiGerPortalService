import BasedocumentationslinkDAO from '../dao/basedocumentationslink.dao';
import type {
  Basedocumentationslink,
  IBasedocumentationslinkDAO
} from '../dao/basedocumentationslink.dao.types';

/**
 * BasedocumentationslinkService — business layer for the base-documents / survey
 * helper links. Depends only on the IBasedocumentationslinkDAO strategy contract
 * (constructor injection), so the storage engine can be swapped by constructing
 * the service with a different DAO.
 */
export class BasedocumentationslinkService {
  constructor(private readonly dao: IBasedocumentationslinkDAO) {}

  findByCategory(category: string) {
    return this.dao.findByCategory(category);
  }

  upsertByCategoryKey(
    category: string,
    key: string,
    set: Partial<Basedocumentationslink>
  ) {
    return this.dao.upsertByCategoryKey(category, key, set);
  }
}

// Production instance, wired to the MongoDB strategy.
const basedocumentationslinkService = new BasedocumentationslinkService(
  BasedocumentationslinkDAO
);

export default basedocumentationslinkService;
