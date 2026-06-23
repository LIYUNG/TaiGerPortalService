import type { IInternaldoc } from '@taiger-common/model';

/** Persistence-agnostic internal-documentation entity. `_id` kept as a STRING. */
export interface Internaldoc extends Omit<IInternaldoc, '_id'> {
  _id: string;
}

export interface IInternaldocDAO {
  findAllTitleInternalCategory(): Promise<Internaldoc[]>;
  getById(docId: string): Promise<Internaldoc | null>;
  create(fields: Partial<Internaldoc>): Promise<Internaldoc>;
  updateById(
    docId: string,
    fields: Partial<Internaldoc>
  ): Promise<Internaldoc | null>;
  deleteById(docId: string): Promise<Internaldoc | null>;
}
