import type { IBasedocumentationslink } from '@taiger-common/model';

/**
 * Persistence-agnostic base-documents / survey-helper link entity. `_id` is kept
 * (as a STRING) so API responses are byte-identical; other fields come from the
 * model interface.
 */
export interface Basedocumentationslink
  extends Omit<IBasedocumentationslink, '_id'> {
  _id: string;
}

/** Strategy contract for base-documentation-link data access. */
export interface IBasedocumentationslinkDAO {
  findByCategory(category: string): Promise<Basedocumentationslink[]>;
  upsertByCategoryKey(
    category: string,
    key: string,
    set: Partial<Basedocumentationslink>
  ): Promise<Basedocumentationslink | null>;
}
