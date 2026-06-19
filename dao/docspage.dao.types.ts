import type { IDocspage } from '@taiger-common/model';

/** Persistence-agnostic docs landing-page entity. `_id` kept as a STRING. */
export interface Docspage extends Omit<IDocspage, '_id'> {
  _id: string;
}

export interface IDocspageDAO {
  upsertByCategory(
    category: string,
    fields: Partial<Docspage>
  ): Promise<Docspage | null>;
  getByCategory(category: string): Promise<Docspage | null>;
}
