/**
 * Persistence-agnostic course keyword-set entity. `_id` is kept (as a STRING,
 * not ObjectId) so API responses are byte-identical to today — only the storage
 * type is normalized. `keywords`/`antiKeywords` are required here (the model
 * types them optional) so callers can read `.zh`/`.en` without null guards.
 */
export interface KeywordSet {
  _id: string;
  categoryName?: string;
  description?: string;
  keywords: { zh: string[]; en: string[] };
  antiKeywords: { zh: string[]; en: string[] };
  createdAt?: Date;
  updatedAt?: Date;
}

/** Domain input for the duplicate-set lookup (no Mongo `$or/$and/$in` leak). */
export interface KeywordSetMatchInput {
  keywords: { zh: string[]; en: string[] };
  antiKeywords: { zh: string[]; en: string[] };
}

/**
 * Strategy contract for keyword-set data access. Domain-level params only — no
 * Mongo `FilterQuery`/`UpdateQuery` — so a PostgreSQL DAO can satisfy it.
 */
export interface IKeywordSetDAO {
  getKeywordSets(): Promise<KeywordSet[]>;
  findKeywordSet(match: KeywordSetMatchInput): Promise<KeywordSet | null>;
  createKeywordSet(fields: Partial<KeywordSet>): Promise<KeywordSet>;
  updateKeywordSetById(
    id: string,
    fields: Partial<KeywordSet>
  ): Promise<KeywordSet | null>;
  deleteKeywordSetById(id: string): Promise<void>;
}
