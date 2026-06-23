import type { IDocumentation } from '@taiger-common/model';

/** Persistence-agnostic public-documentation entity. `_id` kept as a STRING. */
export interface Documentation extends Omit<IDocumentation, '_id'> {
  _id: string;
}

export interface IDocumentationDAO {
  findAllTitleCategory(): Promise<Documentation[]>;
  getById(docId: string): Promise<Documentation | null>;
  create(fields: Partial<Documentation>): Promise<Documentation>;
  updateById(
    docId: string,
    fields: Partial<Documentation>
  ): Promise<Documentation | null>;
  deleteById(docId: string): Promise<Documentation | null>;
}
